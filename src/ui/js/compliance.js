/* ── Compliance tab ──
   Runs the spec compliance check on the host (POST /compliance), which probes the
   server through the same proxy and target policy as every other request, and shows
   the report: verdict, findings with their evidence and spec links, and exports.
   The rules run on the host because they are modern JavaScript and this page stays
   ES5 for older iPad Safari. Credentials go only to the server they are bound to. */

var CMP_ORDER = ['fail', 'error', 'warn', 'pass', 'skipped', 'not-applicable'];
var CMP_CLASS = { pass: 'ok', warn: 'warn', fail: 'fail', error: 'fail', skipped: 'info', 'not-applicable': 'info' };
var CMP_LABEL = { pass: 'Pass', warn: 'Warning', fail: 'Fail', error: 'Error', skipped: 'Skipped', 'not-applicable': 'Not applicable' };
var CMP_SIGN_IN_HINT = 'Sign in from Auth and run the check again to grade the rest.';

/* Credentials for the target: the Headers dialog's, plus Auth's when they are bound to it */
function complianceRequestHeaders(target) {
  var h = copyHeaders({}, state.headers);
  if (canonicalResource(target) === canonicalResource(state.serverUrl)) copyHeaders(h, authHeaders());
  return h;
}

function startComplianceCheck() {
  var target = currentServerUrl();
  if (!target) { showToast('Enter a server URL first', 'err'); return; }
  var c = state.compliance;
  if (c.running) return;
  c.running = true; c.error = null; c.target = target; c.startedAt = Date.now();
  c.controller = window.AbortController ? new AbortController() : null;
  renderComplianceIfShown();
  ensureFreshToken().then(function() { return postCompliance(target, c.controller); })
    .then(function(r) { finishCompliance(target, r); }, function(e) { failCompliance(e); });
}

function postCompliance(target, controller) {
  return fetch('/compliance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: target, headers: complianceRequestHeaders(target), signInHint: CMP_SIGN_IN_HINT }),
    signal: controller ? controller.signal : undefined
  }).then(function(res) { return res.json().then(function(json) { return { status: res.status, json: json }; }); });
}

function finishCompliance(target, r) {
  var c = state.compliance;
  c.running = false; c.controller = null;
  if (r.status !== 200) {
    c.error = (r.json && r.json.error ? r.json.error : 'HTTP ' + r.status) + (r.json && r.json.hint ? ' ' + r.json.hint : '');
  } else {
    c.result = r.json; c.result.target = target; c.result.at = Date.now();
    addLog(r.json.report.verdict === 'fail' ? 'err' : 'res', 'compliance · ' + r.json.report.verdict,
           { body: { summary: r.json.summary, counts: r.json.report.counts } }, 200, null, null);
  }
  updateComplianceBadge();
  renderComplianceIfShown();
}

function failCompliance(e) {
  var c = state.compliance;
  c.running = false; c.controller = null;
  c.error = e && e.name === 'AbortError' ? 'Check cancelled' : 'The check could not run: ' + (e && e.message ? e.message : e);
  renderComplianceIfShown();
}

/* Stops waiting; the host stops sending probes when the request goes away */
function cancelCompliance() {
  var c = state.compliance;
  if (c.controller) c.controller.abort();
}

function toggleComplianceQuiet() {
  state.compliance.showQuiet = !state.compliance.showQuiet;
  renderComplianceIfShown();
}

function copyComplianceMarkdown() {
  var r = state.compliance.result;
  if (r) copyText(r.markdown);
}

function downloadComplianceJson() {
  var r = state.compliance.result;
  if (!r) return;
  var blob = new Blob([JSON.stringify({ target: r.target, generated: new Date(r.at).toISOString(), summary: r.summary, report: r.report }, null, 2)],
                      { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mcp-compliance-' + new Date(r.at).toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

function updateComplianceBadge() {
  var el = document.getElementById('complianceBadge');
  var r = state.compliance.result;
  if (!el) return;
  var n = r ? r.report.counts.fail + r.report.counts.error + r.report.counts.warn : 0;
  el.textContent = String(n);
  el.hidden = !r;
}

function renderComplianceIfShown() {
  if (state.activeTab === 'compliance') renderTab();
}
