/* ── Authentication dialog ──
   Renders the Auth modal from the in-memory auth object and reads it back.
   One small renderer per mode; the flows themselves live in auth.js and auth-refresh.js. */

function forgetCredentials() {
  auth.token = null; auth.bearer = ''; auth.apiKeyValue = ''; auth.clientSecret = '';
  auth.registrations = {}; auth.preIssuer = null; auth.pending = null; auth.trace = [];
  auth.boundTo = null; auth.refreshing = null;
  renderAuthModal(); renderAuthBadge();
  showToast('Credentials forgotten');
}

var AUTH_FORM_FIELDS = { authBearer: 'bearer', authKeyName: 'apiKeyName', authKeyValue: 'apiKeyValue', authClientId: 'clientId',
                         authClientSecret: 'clientSecret', authScope: 'scope', authTokenEndpoint: 'tokenEndpoint',
                         authCcStyle: 'ccStyle', authCcIdField: 'ccIdField', authCcSecretField: 'ccSecretField', authCcBodyFormat: 'ccBodyFormat' };
var AUTH_FORM_CHECKS = { authIssuerMismatch: 'allowIssuerMismatch', authCcStandardParams: 'ccStandardParams' };

function readAuthForm() {
  function el(id) { return document.getElementById(id); }
  if (el('authMode')) auth.mode = el('authMode').value.trim();
  for (var id in AUTH_FORM_FIELDS) { if (el(id)) auth[AUTH_FORM_FIELDS[id]] = el(id).value.trim(); }
  for (var c in AUTH_FORM_CHECKS) { if (el(c)) auth[AUTH_FORM_CHECKS[c]] = el(c).checked; }
}

function applyAuth() {
  var url = currentServerUrl();
  if (!url && auth.mode !== 'none') { showToast('Enter a server URL first', 'err'); return; }
  readAuthForm();
  if (auth.mode === 'bearer' || auth.mode === 'apikey') auth.boundTo = canonicalResource(url);
  hideAuthModal(); renderAuthBadge();
  showToast(auth.mode === 'none' ? 'No credentials will be sent' : 'Credentials applied');
}

function openAuthModal(fromChallenge) {
  if (fromChallenge && auth.mode === 'none') auth.mode = 'oauth';
  document.getElementById('authModal').hidden = false;
  renderAuthModal();
}
function hideAuthModal() { document.getElementById('authModal').hidden = true; }
function onAuthModeChange() { readAuthForm(); renderAuthModal(); }

var AUTH_BADGES = { bearer: ['bearer', 'Bearer'], apikey: ['apiKeyValue', 'Key'], oauth: ['token', 'Token'], client_credentials: ['token', 'Token'] };

function authBadgeLabel() {
  var b = AUTH_BADGES[auth.mode];
  if (b && auth[b[0]]) return b[1];
  var ch = auth.challenge;
  return ch && (ch.status === 401 || ch.status === 403) ? '!' : '';
}

function renderAuthBadge() {
  var el = document.getElementById('authBadge');
  if (!el) return;
  var label = authBadgeLabel();
  el.hidden = !label;
  el.textContent = label;
}

function authField(label, id, value, type, placeholder) {
  return '<label>' + label + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '"' +
         ' placeholder="' + esc(placeholder || '') + '" spellcheck="false" autocapitalize="none" autocomplete="off"></label>';
}

function authCheck(label, id, checked) {
  return '<label class="auth-check"><input id="' + id + '" type="checkbox"' + (checked ? ' checked' : '') + '> ' + label + '</label>';
}

function authSelect(label, id, value, options, onchange) {
  var h = '<label>' + label + '<select id="' + id + '"' + (onchange ? ' onchange="' + onchange + '"' : '') + '>';
  for (var i = 0; i < options.length; i++) {
    h += '<option value="' + options[i][0] + '"' + (value === options[i][0] ? ' selected' : '') + '>' + options[i][1] + '</option>';
  }
  return h + '</select></label>';
}

function authButton(id, onclick, label, primary) {
  return '<button class="btn ' + (primary ? 'btn-primary' : 'btn-ghost') + ' btn-sm"' + (id ? ' id="' + id + '"' : '') +
         ' onclick="' + onclick + '"' + (auth.busy ? ' disabled' : '') + '>' + (auth.busy && primary ? 'Working…' : label) + '</button>';
}

/* Off by default: a compliant client must stop at an issuer mismatch. On, discovery carries on with a warning. */
function issuerMismatchSwitch() {
  return authCheck('Continue past an issuer mismatch <span class="auth-opt">testing only: a compliant client must stop</span>',
                   'authIssuerMismatch', auth.allowIssuerMismatch) +
         (auth.allowIssuerMismatch ? '<div class="auth-note warn">Issuer checks are relaxed: authorization server metadata whose issuer does not match is used anyway. Only for testing.</div>' : '');
}

function renderOAuthFields(ch) {
  return '<div class="auth-note">Finds the authorization server from the MCP server’s metadata, registers this tester, and signs you in with PKCE in a pop-up.</div>' +
    authField('Client ID <span class="auth-opt">optional: only if you registered one with the server</span>', 'authClientId', auth.clientId, 'text', '') +
    authField('Client secret <span class="auth-opt">optional</span>', 'authClientSecret', auth.clientSecret, 'password', '') +
    authField('Scopes <span class="auth-opt">optional: overrides the server’s hint</span>', 'authScope', auth.scope, 'text', (ch && ch.params.scope) || '') +
    issuerMismatchSwitch() +
    '<div class="auth-actions">' + authButton(null, 'discoverOnly()', 'Discover only') + authButton('authSignIn', 'startSignIn()', 'Sign in', true) + '</div>';
}

/* Some token endpoints want the credentials under their own names, e.g. profileID and secret */
function renderCustomCredentialFields() {
  if (auth.ccStyle !== 'custom') return '';
  return '<div class="auth-group">' +
    authField('ID field name', 'authCcIdField', auth.ccIdField, 'text', 'profileID') +
    authField('Secret field name', 'authCcSecretField', auth.ccSecretField, 'text', 'secret') +
    authSelect('Body', 'authCcBodyFormat', auth.ccBodyFormat, [['form', 'Form (application/x-www-form-urlencoded)'], ['json', 'JSON']]) +
    authCheck('Also send grant_type, scope and resource', 'authCcStandardParams', auth.ccStandardParams) + '</div>';
}

function renderClientCredentialFields() {
  return '<div class="auth-note">Machine-to-machine: exchanges a client ID and secret for a token. Leave the token endpoint empty to discover it.</div>' +
    authField('Client ID', 'authClientId', auth.clientId, 'text', '') +
    authField('Client secret', 'authClientSecret', auth.clientSecret, 'password', '') +
    authField('Scopes <span class="auth-opt">optional</span>', 'authScope', auth.scope, 'text', '') +
    authField('Token endpoint <span class="auth-opt">optional</span>', 'authTokenEndpoint', auth.tokenEndpoint, 'url', 'https://auth.example.com/token') +
    authSelect('Send the credentials as', 'authCcStyle', auth.ccStyle,
               [['standard', 'client_id and client_secret (OAuth)'], ['custom', 'Custom field names']], 'onAuthModeChange()') +
    renderCustomCredentialFields() +
    issuerMismatchSwitch() +
    '<div class="auth-actions">' + authButton('authGetToken', 'getClientCredentialsToken()', 'Get token', true) + '</div>';
}

function renderModeFields(ch) {
  if (auth.mode === 'bearer') return authField('Token', 'authBearer', auth.bearer, 'password', 'eyJhbGciOi…');
  if (auth.mode === 'apikey') {
    return authField('Header name', 'authKeyName', auth.apiKeyName, 'text', 'X-API-Key') +
           authField('Value', 'authKeyValue', auth.apiKeyValue, 'password', '');
  }
  if (auth.mode === 'oauth') return renderOAuthFields(ch);
  if (auth.mode === 'client_credentials') return renderClientCredentialFields();
  return '';
}

function renderTokenSummary() {
  var t = auth.token;
  if (!t || (auth.mode !== 'oauth' && auth.mode !== 'client_credentials')) return '';
  var left = t.expires_at ? Math.round((t.expires_at - Date.now()) / 60000) : null;
  var expiry = left === null ? '' : ', ' + (left > 0 ? 'expires in ' + left + ' min' : 'expired');
  return '<div class="auth-token"><span class="log-body-label">Access token</span>' +
         esc(t.access_token.slice(0, 6)) + '… (' + t.access_token.length + ' chars)' +
         (t.issuer ? ' from ' + esc(t.issuer) : '') + expiry +
         (t.scope ? '<br>Scope: ' + esc(t.scope) : '') +
         '<br>' + esc(renewalNote(t)) + '</div>';
}

function renderAuthHeader(url) {
  var h = '<h2>Authentication</h2>' +
    '<div class="auth-note">For <b>' + esc(url || 'no server yet') + '</b>. Kept in memory only: reloading the page forgets it.</div>';
  if (auth.boundTo && url && auth.boundTo !== canonicalResource(url)) {
    h += '<div class="auth-note warn">The current credentials were set up for ' + esc(auth.boundTo) + ' and won’t be sent to this server.</div>';
  }
  var ch = url ? challengeFor(url) : null;
  if (ch) {
    h += '<div class="auth-challenge"><span class="log-body-label">Last challenge</span>HTTP ' + ch.status + ' ' +
         esc(ch.header || '(no WWW-Authenticate header)') + '</div>';
  }
  return h + authSelect('Mode', 'authMode', auth.mode, AUTH_MODES, 'onAuthModeChange()');
}

function renderAuthActions() {
  var manual = auth.mode === 'none' || auth.mode === 'bearer' || auth.mode === 'apikey';
  return '<div class="modal-actions">' +
    '<button class="btn btn-ghost" onclick="forgetCredentials()" style="margin-right:auto">Forget</button>' +
    '<button class="btn btn-ghost" onclick="hideAuthModal()">Close</button>' +
    (manual ? '<button class="btn btn-primary" id="authApply" onclick="applyAuth()">Apply</button>' : '') + '</div>';
}

function renderAuthModal() {
  var box = document.getElementById('authModalBody');
  if (!box || document.getElementById('authModal').hidden) return;
  var url = currentServerUrl();
  box.innerHTML = renderAuthHeader(url) + renderModeFields(url ? challengeFor(url) : null) + renderTokenSummary() +
    '<ol class="auth-trace" id="authTrace"></ol>' + renderAuthActions();
  renderAuthTrace();
}

function renderAuthTrace() {
  var el = document.getElementById('authTrace');
  if (!el) return;
  var h = '';
  for (var i = 0; i < auth.trace.length; i++) {
    var s = auth.trace[i];
    h += '<li class="trace-step ' + s.outcome + '"><div class="trace-head"><span class="trace-dot"></span><b>' + esc(s.name) + '</b>' +
         (s.status ? '<span class="http-status ' + statusClass(s.status) + '">' + s.status + '</span>' : '') + '</div>' +
         '<div class="trace-detail">' + esc(s.detail) + '</div>' +
         (s.url ? '<div class="trace-url">' + esc(s.url) + '</div>' : '') + '</li>';
  }
  el.innerHTML = h;
  el.hidden = !auth.trace.length;
}
