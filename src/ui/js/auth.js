/* ── Authorization (spec 2026-07-28, basic/authorization) ──
   Manual modes (bearer, API-key header, client credentials) and the full OAuth flow:
   401 challenge → protected resource metadata (RFC 9728) → authorization server
   metadata (RFC 8414 / OIDC discovery) → client registration (pre-registered, then
   CIMD, then deprecated DCR) → auth code + PKCE in a popup → iss check (RFC 9207)
   → token request with a resource indicator (RFC 8707).
   Each step lands in auth.trace and the Log, because discovery is where servers break.
   Credentials stay in memory; tokens and secrets are redacted from the Log. */

/* ── Pure helpers ── */

/* RFC 8707 resource identifier: no fragment, and no trailing slash on a bare origin */
function canonicalResource(url) {
  var u;
  try { u = new URL(url); } catch(e) { return url; }
  return u.protocol + '//' + u.host + (u.pathname === '/' ? '' : u.pathname) + u.search;
}

function isLoopbackHost(h) {
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/* The authorization endpoint drives a top-level browser navigation, so it must be
   https (or http on loopback for local testing). Anything else, such as a javascript:
   URL handed back by a hostile or misconfigured authorization server, is refused
   before we navigate the pop-up or the page. */
function isNavigableAuthUrl(url) {
  var u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && isLoopbackHost(u.hostname);
}

/* The Bearer challenge's parameters, e.g. resource_metadata, scope, error */
function parseWwwAuthenticate(header) {
  if (!header) return null;
  var m = /(?:^|,)\s*Bearer\b/i.exec(header);
  var scheme = m ? 'Bearer' : String(header).split(/[\s,]/)[0];
  var rest = m ? header.slice(m.index + m[0].length) : '';
  var params = {}, re = /([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g, p;
  while ((p = re.exec(rest))) {
    var key = p[1].toLowerCase();
    if (!(key in params)) params[key] = p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3];
  }
  return { scheme: scheme, params: params };
}

/* RFC 9728 \u00a73.1: path-inserted well-known URL first, then the root */
function wellKnownPrmUrls(serverUrl) {
  var u = new URL(serverUrl), path = u.pathname.replace(/\/$/, ''), list = [];
  if (path) list.push(u.origin + '/.well-known/oauth-protected-resource' + path);
  list.push(u.origin + '/.well-known/oauth-protected-resource');
  return list;
}

/* Spec priority order for RFC 8414 and OpenID Connect discovery */
function asMetadataUrls(issuer) {
  var u = new URL(issuer), o = u.origin, path = u.pathname.replace(/\/$/, '');
  if (path) return [o + '/.well-known/oauth-authorization-server' + path,
                    o + '/.well-known/openid-configuration' + path,
                    o + path + '/.well-known/openid-configuration'];
  return [o + '/.well-known/oauth-authorization-server', o + '/.well-known/openid-configuration'];
}

/* RFC 9207 \u00a72.4 as tabled in the spec; returns a problem string, or null to proceed.
   Plain string comparison: no case folding, port or trailing-slash normalisation. */
function checkIss(iss, expectedIssuer, issSupported) {
  if (iss === undefined || iss === null) {
    return issSupported ? 'The response has no iss, but the server advertises authorization_response_iss_parameter_supported' : null;
  }
  return iss === expectedIssuer ? null : 'iss "' + iss + '" does not match the expected issuer "' + expectedIssuer + '"';
}

function redact(o) {
  if (!o || typeof o !== 'object') return o;
  var out = Array.isArray(o) ? [] : {};
  for (var k in o) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
    var v = o[k];
    if (REDACT_KEYS.indexOf(k) !== -1 && typeof v === 'string') out[k] = '[redacted, ' + v.length + ' chars]';
    else out[k] = redact(v);
  }
  return out;
}

function formEncode(obj) {
  var parts = [];
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    }
  }
  return parts.join('&');
}

function parseQuery(search) {   // keeps only the authorization response's parameters (RFC 6749 4.1.2, RFC 9207)
  var out = {}, keep = ['code', 'state', 'iss', 'error', 'error_description', 'error_uri'];
  var pairs = String(search || '').replace(/^\?/, '').split('&');
  for (var i = 0; i < pairs.length; i++) {
    var eq = pairs[i].indexOf('=');
    var k = decodeURIComponent((eq === -1 ? pairs[i] : pairs[i].slice(0, eq)).replace(/\+/g, ' '));
    if (keep.indexOf(k) !== -1) out[k] = decodeURIComponent((eq === -1 ? '' : pairs[i].slice(eq + 1)).replace(/\+/g, ' '));
  }
  return out;
}

function b64url(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(nBytes) {
  var a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return b64url(a);
}
function makePkce() {
  if (!window.crypto || !crypto.subtle) {
    return Promise.reject(new Error('PKCE needs a secure context: open the tester over HTTPS or on localhost'));
  }
  var verifier = randomString(32);
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function(h) {
    return { verifier: verifier, challenge: b64url(new Uint8Array(h)) };
  });
}

function redirectUri() { return location.origin + '/oauth/callback'; }
function currentServerUrl() { return document.getElementById('urlInput').value.trim(); }

/* ── Credentials on requests ── */
function authHeaders() {
  var h = {};
  if (!auth.boundTo || auth.boundTo !== canonicalResource(state.serverUrl)) return h;
  if (auth.mode === 'bearer' && auth.bearer) h['Authorization'] = 'Bearer ' + auth.bearer;
  else if (auth.mode === 'apikey' && auth.apiKeyName && auth.apiKeyValue) h[auth.apiKeyName] = auth.apiKeyValue;
  else if ((auth.mode === 'oauth' || auth.mode === 'client_credentials') && auth.token) h['Authorization'] = 'Bearer ' + auth.token.access_token;
  return h;
}

function noteAuthChallenge(status, header) {
  var parsed = parseWwwAuthenticate(header) || { scheme: null, params: {} };
  auth.challenge = { status: status, header: header || null, scheme: parsed.scheme, params: parsed.params,
                     server: canonicalResource(state.serverUrl), at: Date.now() };
  if (status === 403 && parsed.params.error === 'insufficient_scope') {
    showToast('The server needs more scope' + (parsed.params.scope ? ': ' + parsed.params.scope : '') + '. Sign in again from Auth.', 'err');
  }
  renderAuthBadge();
}

/* ── HTTP via the proxy, logged and redacted ── */
function oauthHttp(step, url, opts) {
  opts = opts || {};
  var method = opts.method || 'GET';
  addLog('req', 'oauth \u00b7 ' + step, { body: redact(opts.logBody || { url: url, method: method }) }, null, null, null);
  return proxyFetch(url, { method: method, headers: opts.headers || { 'Accept': 'application/json' }, body: opts.body || null, purpose: 'oauth' })
    .then(function(res) {
      var json = null;
      try { json = JSON.parse(res.bodyText); } catch(e) {}
      var ok = res.ok && !(res.diag && res.diag.ok === false);
      addLog(ok ? 'res' : 'err', 'oauth \u00b7 ' + step,
             { body: redact(json !== null ? json : (res.proxyError ? { proxyError: res.proxyError } : { raw: res.bodyText })) },
             res.status || null, res.headers, res);
      return { ok: ok, status: res.status, json: json, headers: res.headers, diag: res.diag, proxyError: res.proxyError };
    }, function(e) {
      addLog('err', 'oauth \u00b7 ' + step, { body: { error: e.message } }, null, null, null);
      return { ok: false, status: null, json: null, headers: {}, diag: null, proxyError: e.message };
    });
}

function httpProblem(r) {
  if (r.proxyError) return 'Proxy: ' + r.proxyError;
  if (r.diag && r.diag.ok === false) return r.diag.errorDetail || 'transport failure';
  var j = r.json || {};
  return 'HTTP ' + r.status + (j.error ? ': ' + j.error + (j.error_description ? ' (' + j.error_description + ')' : '') : '');
}

function traceStep(name, outcome, detail, extra) {
  extra = extra || {};
  auth.trace.push({ name: name, outcome: outcome, detail: detail || '', url: extra.url || null, status: extra.status || null });
  renderAuthTrace();
}

/* GET each URL in turn until one returns a JSON document that passes check() */
function firstUsableDoc(step, urls, check) {
  var i = 0;
  function next() {
    if (i >= urls.length) return Promise.reject(new Error(step + ': no usable document found'));
    var url = urls[i++];
    return oauthHttp(step, url).then(function(r) {
      var problem = !r.ok ? httpProblem(r) : (r.json === null || typeof r.json !== 'object') ? 'Response is not a JSON object' : check(r.json, url);
      if (problem) { traceStep(step, 'fail', problem, { url: url, status: r.status }); return next(); }
      traceStep(step, 'ok', 'Found', { url: url, status: r.status });
      return { url: url, doc: r.json };
    });
  }
  return next();
}

/* ── Discovery ── */
/* The last challenge, if it came from this server: another server's hints must not steer discovery */
function challengeFor(serverUrl) {
  var ch = auth.challenge;
  return ch && ch.server === canonicalResource(serverUrl) ? ch : null;
}

function discoverAuth(serverUrl) {
  var ch = challengeFor(serverUrl), urls = [];
  if (ch && ch.params.resource_metadata) {
    traceStep('Challenge', 'ok', 'HTTP ' + ch.status + ' ' + (ch.header || ''));
    urls.push(ch.params.resource_metadata);
  } else if (ch) {
    traceStep('Challenge', 'warn', 'HTTP ' + ch.status + (ch.header ? ' ' + ch.header : ' with no WWW-Authenticate') + '. No resource_metadata, so trying the well-known URLs');
  } else {
    traceStep('Challenge', 'info', 'No 401 seen yet; trying the well-known URLs');
  }
  var wk = wellKnownPrmUrls(serverUrl);
  for (var i = 0; i < wk.length; i++) if (urls.indexOf(wk[i]) === -1) urls.push(wk[i]);

  return firstUsableDoc('Protected resource metadata', urls, function(doc) {
    if (!Array.isArray(doc.authorization_servers) || !doc.authorization_servers.length) return 'No authorization_servers listed';
    return null;
  }).then(function(prm) {
    var resource = canonicalResource(serverUrl), origin = new URL(serverUrl).origin;
    if (prm.doc.resource && prm.doc.resource !== resource && prm.doc.resource !== origin) {
      traceStep('Resource check', 'warn', 'Metadata says resource "' + prm.doc.resource + '" but the server URL is "' + resource +
                '". RFC 9728 says clients must not use metadata for a different resource; continuing so you can test further.');
    }
    var issuer = prm.doc.authorization_servers[0];
    if (prm.doc.authorization_servers.length > 1) traceStep('Authorization server', 'info', 'Several listed; using the first: ' + issuer);
    return firstUsableDoc('Authorization server metadata', asMetadataUrls(issuer), function(doc) {
      return issuerProblem(doc, issuer) || (doc.token_endpoint ? null : 'No token_endpoint');
    }).then(function(as) {
      if (as.doc.issuer !== issuer) {
        traceStep('Issuer check (RFC 8414)', 'warn', 'issuer "' + as.doc.issuer + '" is not "' + issuer + '". Continuing only because ' +
                  '\u201cContinue past an issuer mismatch\u201d is on: a compliant client must stop here, so fix the server.');
      }
      var scope = auth.scope || (ch && ch.params.scope) || (prm.doc.scopes_supported || []).join(' ');
      return { prm: prm.doc, as: as.doc, resource: prm.doc.resource || resource, scope: scope };
    });
  });
}

/* RFC 8414 \u00a73.3: metadata whose issuer differs must not be used, unless the testing switch is on */
function issuerProblem(doc, issuer) {
  if (doc.issuer === issuer || (auth.allowIssuerMismatch && typeof doc.issuer === 'string' && doc.issuer)) return null;
  return 'issuer "' + doc.issuer + '" is not "' + issuer + '", so this document must not be used (RFC 8414 \u00a73.3)' +
         (auth.allowIssuerMismatch ? '' : '. To test further anyway, turn on \u201cContinue past an issuer mismatch\u201d.');
}

/* Priority per spec: pre-registered → CIMD → DCR (deprecated) → ask the user */
function registerClient(as) {
  var issuer = as.issuer;
  if (auth.clientId) {
    if (auth.preIssuer && auth.preIssuer !== issuer) {
      traceStep('Client registration', 'fail', 'The client ID was set up with ' + auth.preIssuer + ', but this server now uses ' + issuer + '. Enter the client ID for the new authorization server.');
      return Promise.reject(new Error('client ID belongs to a different authorization server'));
    }
    auth.preIssuer = issuer;
    traceStep('Client registration', 'ok', 'Using the pre-registered client ID ' + auth.clientId);
    return Promise.resolve({ client_id: auth.clientId, client_secret: auth.clientSecret || null, how: 'pre-registered' });
  }
  var cimdUsable = location.protocol === 'https:' && !isLoopbackHost(location.hostname);
  if (as.client_id_metadata_document_supported === true && cimdUsable) {
    var reg = { client_id: location.origin + '/oauth/client-metadata.json', client_secret: null, how: 'client ID metadata document' };
    traceStep('Client registration', 'ok', 'Client ID metadata document: ' + reg.client_id);
    return Promise.resolve(reg);
  }
  if (auth.registrations[issuer]) {
    traceStep('Client registration', 'ok', 'Reusing ' + auth.registrations[issuer].client_id + ' registered earlier with ' + issuer);
    return Promise.resolve(auth.registrations[issuer]);
  }
  var why = as.client_id_metadata_document_supported !== true ? 'the server does not advertise client ID metadata documents'
          : 'metadata documents need a public HTTPS origin, and this tester runs on ' + location.origin;
  if (!as.registration_endpoint) {
    traceStep('Client registration', 'fail', 'No way to register: ' + why + ', and there is no registration_endpoint. Enter a pre-registered client ID.');
    return Promise.reject(new Error('enter a pre-registered client ID'));
  }
  traceStep('Client registration', 'info', 'Falling back to dynamic client registration (deprecated in 2026-07-28), because ' + why);
  var body = {
    client_name: 'MCP Tester', redirect_uris: [redirectUri()],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: isLoopbackHost(location.hostname) ? 'native' : 'web'
  };
  return oauthHttp('Dynamic client registration', as.registration_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body), logBody: body
  }).then(function(r) {
    if (!r.ok || !r.json || !r.json.client_id) {
      traceStep('Dynamic client registration', 'fail', r.ok ? 'No client_id in the response' : httpProblem(r), { url: as.registration_endpoint, status: r.status });
      throw new Error('registration failed');
    }
    var reg = { client_id: r.json.client_id, client_secret: r.json.client_secret || null, how: 'dynamic registration' };
    auth.registrations[issuer] = reg;
    traceStep('Dynamic client registration', 'ok', 'client_id ' + reg.client_id + ' (' + body.application_type + ')', { url: as.registration_endpoint, status: r.status });
    return reg;
  });
}

function tokenRequest(step, endpoint, params, client, authMethods) {
  var headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' };
  var methods = authMethods || ['client_secret_basic'];
  if (client.client_secret && methods.indexOf('client_secret_basic') !== -1) {
    headers['Authorization'] = 'Basic ' + btoa(encodeURIComponent(client.client_id) + ':' + encodeURIComponent(client.client_secret));
  } else {
    params.client_id = client.client_id;
    if (client.client_secret) params.client_secret = client.client_secret;
  }
  return oauthHttp(step, endpoint, { method: 'POST', headers: headers, body: formEncode(params), logBody: params });
}

function acceptToken(step, r, endpoint, extra) {
  if (!r.ok || !r.json || !r.json.access_token) {
    traceStep(step, 'fail', r.ok ? 'No access_token in the response' : httpProblem(r), { url: endpoint, status: r.status });
    throw new Error('token request failed');
  }
  var t = r.json;
  if (t.token_type && String(t.token_type).toLowerCase() !== 'bearer') {
    traceStep(step, 'warn', 'token_type is "' + t.token_type + '", not Bearer');
  }
  auth.token = {
    access_token: t.access_token, token_type: t.token_type || 'Bearer',
    expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : null,
    refresh_token: t.refresh_token || null, scope: t.scope || extra.scope || null, issuer: extra.issuer || null,
    renew: extra.renew
  };
  auth.boundTo = extra.boundTo;
  traceStep(step, 'ok', 'Access token received' + (t.expires_in ? ', expires in ' + t.expires_in + 's' : '') +
            (t.refresh_token ? ', with a refresh token' : ''), { url: endpoint, status: r.status });
}

/* ── Flows ── */
function startSignIn() {
  var serverUrl = currentServerUrl();
  if (!serverUrl) { showToast('Enter a server URL first', 'err'); return; }
  readAuthForm();
  auth.mode = 'oauth';
  // Open the window now, while we still have the click: pop-up blockers (and iPad Safari) require it.
  // If pop-ups are blocked anyway, this page redirects instead and resumes on return.
  var popup = window.open('', 'mcp_tester_oauth', 'width=520,height=720');
  if (popup) {
    try { popup.document.title = 'Signing in\u2026'; popup.document.body.textContent = 'Finding the authorization server\u2026'; } catch(e) {}
  }
  auth.trace = []; auth.busy = true; auth.pending = null;
  renderAuthModal();

  discoverAuth(serverUrl).then(function(d) {
    var methods = d.as.code_challenge_methods_supported;
    if (!methods || methods.indexOf('S256') === -1) {
      traceStep('PKCE support', 'fail', methods ? 'code_challenge_methods_supported lacks S256: ' + methods.join(', ')
                                                : 'The server does not advertise code_challenge_methods_supported, so PKCE support cannot be confirmed');
      throw new Error('no PKCE S256');
    }
    if (!d.as.authorization_endpoint) { traceStep('Authorization endpoint', 'fail', 'No authorization_endpoint in the metadata'); throw new Error('no authorization_endpoint'); }
    if (!isNavigableAuthUrl(d.as.authorization_endpoint)) {
      traceStep('Authorization endpoint', 'fail', 'authorization_endpoint must be https (or http on loopback); refusing to open "' + d.as.authorization_endpoint + '"');
      throw new Error('unsafe authorization_endpoint');
    }
    return registerClient(d.as).then(function(client) {
      return makePkce().then(function(pkce) {
        var st = randomString(16);
        auth.pending = {
          state: st, verifier: pkce.verifier, issuer: d.as.issuer,
          issSupported: d.as.authorization_response_iss_parameter_supported === true,
          tokenEndpoint: d.as.token_endpoint, authMethods: d.as.token_endpoint_auth_methods_supported,
          client: client, resource: d.resource, scope: d.scope, popup: popup,
          boundTo: canonicalResource(serverUrl)
        };
        var q = { response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri(),
                  code_challenge: pkce.challenge, code_challenge_method: 'S256', state: st,
                  resource: d.resource, scope: d.scope };
        var ep = d.as.authorization_endpoint, target = ep + (ep.indexOf('?') === -1 ? '?' : '&') + formEncode(q);
        var scopeNote = d.scope ? ' (scope "' + d.scope + '")' : ' (no scope)';
        if (popup) {
          traceStep('Authorization request', 'info', 'Sign in in the pop-up window' + scopeNote, { url: ep });
          popup.location.href = target;
          return;
        }
        traceStep('Authorization request', 'info', 'Pop-ups are blocked, so this page redirects to sign in and resumes when it returns' + scopeNote, { url: ep });
        if (!savePendingRedirect()) throw new Error('pop-ups are blocked and this browser cannot keep the sign-in state; allow pop-ups');
        location.href = target;
      });
    });
  }).catch(function(e) {
    try { if (popup) popup.close(); } catch(x) {}
    auth.busy = false; auth.pending = null;
    showToast('Sign-in stopped: ' + e.message, 'err');
    renderAuthModal();
  });
}

function onAuthMessage(ev) {
  if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'mcp-tester-oauth') return;
  var p = auth.pending;
  if (!p || ev.source !== p.popup) return;
  handleAuthResponse(parseQuery(ev.data.search));
}

function handleAuthResponse(q) {
  var p = auth.pending;
  auth.pending = null;
  try { if (p.popup) p.popup.close(); } catch(e) {}
  function stop(msg) { auth.busy = false; renderAuthModal(); showToast(msg, 'err'); }
  if (q.state !== p.state) { traceStep('Authorization response', 'fail', 'state does not match the request, so the response is ignored'); return stop('Sign-in failed'); }
  // Before anything else, including showing an error: an unchecked issuer is a mix-up attack
  var issProblem = checkIss(q.iss, p.issuer, p.issSupported);
  if (issProblem) { traceStep('Issuer check (RFC 9207)', 'fail', issProblem + '. The code was not sent anywhere.'); return stop('Sign-in rejected: issuer mismatch'); }
  traceStep('Issuer check (RFC 9207)', q.iss ? 'ok' : 'warn', q.iss ? 'iss matches ' + p.issuer : 'No iss in the response; allowed because the server does not advertise support');
  if (q.error) { traceStep('Authorization response', 'fail', q.error + (q.error_description ? ': ' + q.error_description : '')); return stop('Sign-in failed: ' + q.error); }
  if (!q.code) { traceStep('Authorization response', 'fail', 'No code in the response'); return stop('Sign-in failed'); }
  traceStep('Authorization response', 'ok', 'Received an authorization code');

  tokenRequest('Token request', p.tokenEndpoint, {
    grant_type: 'authorization_code', code: q.code, redirect_uri: redirectUri(),
    code_verifier: p.verifier, resource: p.resource
  }, p.client, p.authMethods).then(function(r) {
    acceptToken('Token request', r, p.tokenEndpoint, { issuer: p.issuer, boundTo: p.boundTo, scope: p.scope,
      renew: { grant: 'refresh_token', endpoint: p.tokenEndpoint, client: p.client, authMethods: p.authMethods, resource: p.resource } });
    auth.busy = false;
    renderAuthModal(); renderAuthBadge();
    showToast('Signed in');
    if (!state.connected && !state.connecting && canonicalResource(currentServerUrl()) === p.boundTo) { hideAuthModal(); handleConnect(); }
  }).catch(function(e) { stop('Sign-in failed: ' + e.message); });
}

function getClientCredentialsToken() {
  var serverUrl = currentServerUrl();
  if (!serverUrl) { showToast('Enter a server URL first', 'err'); return; }
  readAuthForm();
  auth.mode = 'client_credentials';
  if (!auth.clientId || !auth.clientSecret) { showToast('Client credentials need a client ID and secret', 'err'); return; }
  var cc = customCredentialSettings();
  if (!cc) { showToast('Custom credentials need two different field names', 'err'); return; }
  auth.trace = []; auth.busy = true;
  renderAuthModal();
  var where = auth.tokenEndpoint
    ? Promise.resolve({ tokenEndpoint: auth.tokenEndpoint, methods: null, issuer: null, resource: canonicalResource(serverUrl), scope: auth.scope })
    : discoverAuth(serverUrl).then(function(d) {
        return { tokenEndpoint: d.as.token_endpoint, methods: d.as.token_endpoint_auth_methods_supported, issuer: d.as.issuer, resource: d.resource, scope: d.scope };
      });
  where.then(function(w) {
    var renew = { grant: 'client_credentials', endpoint: w.tokenEndpoint, client: { client_id: auth.clientId, client_secret: auth.clientSecret },
                  authMethods: w.methods, resource: w.resource, scope: w.scope, cc: cc };
    return clientCredentialsRequest('Token request (client credentials)', renew).then(function(r) {
      acceptToken('Token request (client credentials)', r, w.tokenEndpoint, { issuer: w.issuer, boundTo: canonicalResource(serverUrl), scope: w.scope, renew: renew });
      auth.busy = false;
      renderAuthModal(); renderAuthBadge();
      showToast('Token received');
      if (!state.connected && !state.connecting) { hideAuthModal(); handleConnect(); }
    });
  }).catch(function(e) {
    auth.busy = false;
    renderAuthModal();
    showToast('No token: ' + e.message, 'err');
  });
}

function discoverOnly() {
  var serverUrl = currentServerUrl();
  if (!serverUrl) { showToast('Enter a server URL first', 'err'); return; }
  readAuthForm();
  auth.trace = []; auth.busy = true;
  renderAuthModal();
  discoverAuth(serverUrl).then(function(d) {
    var m = d.as.code_challenge_methods_supported;
    traceStep('PKCE support', m && m.indexOf('S256') !== -1 ? 'ok' : 'fail', m ? 'Methods: ' + m.join(', ') : 'code_challenge_methods_supported is missing');
    traceStep('Registration options', 'info',
      'Client ID metadata documents: ' + (d.as.client_id_metadata_document_supported === true ? 'yes' : 'no') +
      '; dynamic registration: ' + (d.as.registration_endpoint ? 'yes (deprecated)' : 'no') +
      '; iss in responses: ' + (d.as.authorization_response_iss_parameter_supported === true ? 'yes' : 'not advertised'));
  }).catch(function() {}).then(function() { auth.busy = false; renderAuthModal(); });
}

/* ── Redirect fallback ──
   Only the in-flight request is kept, in this tab's sessionStorage, and it is removed
   the moment the page returns. Tokens never leave memory, and neither does a client
   secret: it is left out, and a sign-in that needs one asks for it again on return. */
function savePendingRedirect() {
  var p = auth.pending, pending = {};
  for (var k in p) { if (Object.prototype.hasOwnProperty.call(p, k) && k !== 'popup') pending[k] = p[k]; }
  if (p.client && p.client.client_secret) {
    var client = {};
    for (var c in p.client) { if (Object.prototype.hasOwnProperty.call(p.client, c) && c !== 'client_secret') client[c] = p.client[c]; }
    pending.client = client;
    pending.secretRequired = true;
  }
  try {
    sessionStorage.setItem('mcp_oauth_pending', JSON.stringify({
      pending: pending, clientId: auth.clientId, scope: auth.scope, preIssuer: auth.preIssuer, trace: auth.trace
    }));
    return true;
  } catch(e) { return false; }
}
function takePendingRedirect() {
  var saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem('mcp_oauth_pending') || 'null');
    sessionStorage.removeItem('mcp_oauth_pending');
  } catch(e) {}
  return saved;
}
function isRedirectCallback() {
  try {
    var saved = JSON.parse(sessionStorage.getItem('mcp_oauth_pending') || 'null');
    return !!(saved && saved.pending && saved.pending.state === parseQuery(location.search).state);
  } catch(e) { return false; }
}
function resumeRedirectSignIn() {
  var search = location.search;
  try { history.replaceState(null, '', '/'); } catch(e) {}   // keep the code out of history
  var saved = takePendingRedirect();
  if (!saved) return;
  var p = saved.pending;
  auth.mode = 'oauth'; auth.clientId = saved.clientId || ''; auth.scope = saved.scope || '';
  auth.preIssuer = saved.preIssuer || null; auth.trace = saved.trace || [];
  if (p.client && p.client.how === 'dynamic registration') auth.registrations[p.issuer] = p.client;
  auth.pending = p; auth.busy = true;
  openAuthModal();
  if (p.secretRequired) return askForSecretAgain();
  handleAuthResponse(parseQuery(search));
}

/* The secret was not kept across the redirect, so the code cannot be exchanged here */
function askForSecretAgain() {
  auth.pending = null; auth.busy = false; auth.clientSecret = '';
  traceStep('Token request', 'fail', 'The client secret is not kept across the redirect, so the code was not exchanged. ' +
    'Enter the client secret again and sign in, or allow pop-ups so sign-in stays in this page.');
  renderAuthModal();
  showToast('Enter the client secret again to finish signing in', 'err');
}

/* The OAuth redirect lands on this same page in the pop-up: hand the result back and close */
function finishOAuthPopup() {
  var search = location.search, msg;
  try { history.replaceState(null, '', location.pathname); } catch(e) {}   // keep the code out of history
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: 'mcp-tester-oauth', search: search }, location.origin);
    msg = 'Sign-in finished. You can close this window.';
    setTimeout(function() { window.close(); }, 100);
  } else {
    msg = 'Sign-in finished, but the MCP Tester window that started it has gone. Start again from there.';
  }
  document.body.innerHTML = '<div class="empty-state" style="padding:40px 20px">' + esc(msg) + '</div>';
}
