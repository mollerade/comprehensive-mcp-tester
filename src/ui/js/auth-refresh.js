/* ── Keeping a token fresh, and non-standard client credentials ──
   A token carries `renew`: how to get the next one.
     { grant: 'refresh_token', endpoint, client, authMethods, resource }      after an OAuth sign-in (RFC 6749 §6)
     { grant: 'client_credentials', endpoint, client, authMethods, resource, scope, cc }   after client credentials
   Before a request, a token that expires within a minute is renewed. A 401 to a
   request that carried the token renews it once and resends; a second 401 is shown
   as it is. A renewal that fails drops `renew`, so it is not retried on every call.
   Every renewal is a trace step and an oauth Log entry, with secrets redacted. */

var RENEW_MARGIN_MS = 60000;

function tokenInUse() {
  var t = auth.token;
  return !!(t && (auth.mode === 'oauth' || auth.mode === 'client_credentials') &&
            auth.boundTo && auth.boundTo === canonicalResource(state.serverUrl));
}

function tokenRenewable() {
  var r = auth.token && auth.token.renew;
  if (!r) return false;
  return r.grant === 'client_credentials' ? !!r.client.client_secret : !!auth.token.refresh_token;
}

function tokenExpiring() {
  var t = auth.token;
  return !!(t && t.expires_at && t.expires_at - Date.now() < RENEW_MARGIN_MS);
}

function renewalNote(t) {
  if (!t.renew) return 'Not renewed automatically: sign in again when it expires.';
  if (t.renew.grant === 'client_credentials') return 'Renewed automatically with the client credentials.';
  return t.refresh_token ? 'Renewed automatically with the refresh token.' : 'No refresh token: sign in again when it expires.';
}

/* Resolves when the request may go: renewed if it was about to expire, or as it was */
function ensureFreshToken() {
  if (!tokenInUse() || !tokenExpiring() || !tokenRenewable()) return Promise.resolve();
  return renewToken('expiring').catch(function() {});
}

/* A 401 to a request that carried our token: renew once and resend, else hand back the 401 */
function retryAfterRenewal(res, body, method, gen) {
  if (res.status !== 401 || !tokenInUse() || !tokenRenewable() || isStale(gen)) return Promise.resolve(res);
  addLog('err', method, { body: parseResponseBody(res).data }, res.status, res.headers, res);
  return renewToken('rejected').then(function() {
    if (isStale(gen)) return res;
    addLog('req', method + ' (resent with the renewed token)', { body: body }, null, null, null);
    return postToServer(body);
  }, function() { return res; });
}

function renewToken(why) {
  if (auth.refreshing) return auth.refreshing;
  var t = auth.token, r = t.renew;
  var step = r.grant === 'client_credentials' ? 'Token renewal (client credentials)' : 'Token refresh';
  traceStep('Token renewal needed', 'info', why === 'rejected' ? 'The server answered 401 to the current token; renewing it once'
                                             : 'The token expires within a minute; renewing it before the request');
  var boundTo = auth.boundTo;
  auth.refreshing = renewalRequest(step, t, r).then(function(res) {
    acceptToken(step, res, r.endpoint, { issuer: t.issuer, boundTo: boundTo, scope: t.scope, renew: r });
    // RFC 6749 §6: the old refresh token stays usable unless the response replaces it
    if (!auth.token.refresh_token && t.refresh_token) auth.token.refresh_token = t.refresh_token;
    auth.refreshing = null;
    renderAuthBadge(); renderAuthModal();
  }).catch(function(e) {   // after the success handler, so a rejected token response lands here too
    auth.refreshing = null;
    t.renew = null;
    showToast('The token could not be renewed. Sign in again from Auth.', 'err');
    renderAuthModal();
    throw e;
  });
  return auth.refreshing;
}

function renewalRequest(step, t, r) {
  if (r.grant === 'client_credentials') return clientCredentialsRequest(step, r);
  return tokenRequest(step, r.endpoint, { grant_type: 'refresh_token', refresh_token: t.refresh_token, resource: r.resource },
                      r.client, r.authMethods);
}

/* The client credentials grant, standard (RFC 6749 §4.4) or with the fields named as the server wants */
function clientCredentialsRequest(step, r) {
  var params = { grant_type: 'client_credentials', scope: r.scope, resource: r.resource };
  if (!r.cc || r.cc.style !== 'custom') return tokenRequest(step, r.endpoint, params, r.client, r.authMethods);
  return customCredentialsRequest(step, r.endpoint, r.client, r.cc, params);
}

function customCredentialsRequest(step, endpoint, client, cc, standard) {
  var body = cc.standardParams ? copyDefined(standard) : {};
  body[cc.idField] = client.client_id;
  body[cc.secretField] = client.client_secret;
  var logBody = copyDefined(body);
  logBody[cc.secretField] = '[redacted, ' + String(client.client_secret).length + ' chars]';
  var json = cc.bodyFormat === 'json';
  return oauthHttp(step, endpoint, {
    method: 'POST', logBody: logBody,
    headers: { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: json ? JSON.stringify(body) : formEncode(body)
  });
}

function copyDefined(o) {
  var out = {};
  for (var k in o) {
    if (Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
  }
  return out;
}

/* The custom-field settings, checked: both names given and different */
function customCredentialSettings() {
  if (auth.ccStyle !== 'custom') return { style: 'standard' };
  var id = auth.ccIdField || '', secret = auth.ccSecretField || '';
  if (!id || !secret || id === secret) return null;
  return { style: 'custom', idField: id, secretField: secret, bodyFormat: auth.ccBodyFormat === 'json' ? 'json' : 'form',
           standardParams: auth.ccStandardParams !== false };
}
