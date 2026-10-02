/* ── Compliance tab: rendering ── */

function renderCompliance() {
  var c = state.compliance;
  var h = '<div class="cmp">' + renderComplianceHead(c);
  if (c.running) h += '<div class="auth-note">Checking ' + esc(c.target) + '… probes go through the proxy; nothing calls a tool.</div>';
  if (c.error) h += '<div class="auth-note warn" id="complianceError">' + esc(c.error) + '</div>';
  if (c.result) h += renderComplianceReport(c.result, c.showQuiet);
  else if (!c.running && !c.error) h += '<div class="empty-state">Probes the server and grades it against the protocol version it claims: JSON-RPC, transport, sessions, the handshake, what it lists, and its authorization discovery. Nothing calls a tool.</div>';
  return h + '</div>';
}

function renderComplianceHead(c) {
  var h = '<div class="cmp-head"><div class="cmp-title"><b>Spec compliance</b><span class="cmp-target">' + esc(currentServerUrl() || 'no server yet') + '</span></div><div class="cmp-actions">';
  if (c.running) h += '<button class="btn btn-ghost btn-sm" id="complianceCancel" onclick="cancelCompliance()">Cancel</button>';
  else h += '<button class="btn btn-primary btn-sm" id="complianceRun" onclick="startComplianceCheck()">' + (c.result ? 'Run again' : 'Run check') + '</button>';
  if (c.result && !c.running) {
    h += '<button class="btn btn-ghost btn-sm" id="complianceCopy" onclick="copyComplianceMarkdown()">Copy Markdown</button>' +
         '<button class="btn btn-ghost btn-sm" id="complianceJson" onclick="downloadComplianceJson()">Download JSON</button>';
  }
  return h + '</div></div>';
}

function complianceVerdictText(r) {
  if (!r.summary.graded) return 'Not graded';
  return { pass: 'Pass', warn: 'Pass with warnings', fail: 'Fail' }[r.report.verdict];
}

function renderComplianceSummary(r) {
  var rep = r.report, s = r.summary;
  var verdictClass = !s.graded ? 'info' : CMP_CLASS[rep.verdict];
  var h = '<div class="cmp-summary trace-step ' + verdictClass + '"><div class="trace-head"><span class="trace-dot"></span><b id="complianceVerdict">' +
          esc(complianceVerdictText(r)) + '</b><span class="cmp-counts">' + esc(complianceCountsText(rep.counts)) + '</span></div>';
  h += '<div class="trace-detail">' + esc(r.target) + ' · ' + esc(s.era || 'era unknown') + ', claimed version ' +
       esc(rep.claimedVersion || 'none') + ', graded against ' + esc(rep.version) + (rep.bestEffort ? ' (best effort)' : '') + '</div>';
  var caveat = complianceCaveatText(s);
  if (caveat) h += '<div class="trace-detail cmp-caveat">' + esc(caveat) + '</div>';
  return h + '</div>';
}

function complianceCountsText(counts) {
  var parts = [];
  for (var i = 0; i < CMP_ORDER.length; i++) if (counts[CMP_ORDER[i]]) parts.push(counts[CMP_ORDER[i]] + ' ' + CMP_LABEL[CMP_ORDER[i]].toLowerCase());
  return parts.join(', ');
}

/* Mirrors complianceCaveat() in src/core/compliance/report.js */
function complianceCaveatText(s) {
  if (s.era) return null;
  if (s.authGraded) return 'Only authorization was graded: the server asks for a sign-in. ' + CMP_SIGN_IN_HINT;
  return 'No handshake succeeded, so the server was not graded: ' + (s.handshakeError || 'no response') + '.';
}

function renderComplianceReport(r, showQuiet) {
  var rows = r.report.results.slice().sort(function(a, b) { return CMP_ORDER.indexOf(a.status) - CMP_ORDER.indexOf(b.status); });
  var loud = [], quiet = [];
  for (var i = 0; i < rows.length; i++) (CMP_CLASS[rows[i].status] === 'info' ? quiet : loud).push(rows[i]);
  var h = renderComplianceSummary(r) + '<ol class="auth-trace cmp-results" id="complianceResults">';
  for (var j = 0; j < loud.length; j++) h += renderComplianceRow(loud[j]);
  if (showQuiet) for (var k = 0; k < quiet.length; k++) h += renderComplianceRow(quiet[k]);
  h += '</ol>';
  if (quiet.length) {
    h += '<button class="btn btn-ghost btn-sm" onclick="toggleComplianceQuiet()">' + (showQuiet ? 'Hide' : 'Show') +
         ' skipped and not applicable (' + quiet.length + ')</button>';
  }
  return h;
}

function renderComplianceRow(res) {
  var h = '<li class="trace-step ' + CMP_CLASS[res.status] + '" data-rule="' + esc(res.id) + '" data-status="' + esc(res.status) + '">' +
          '<div class="trace-head"><span class="trace-dot"></span><b>' + esc(res.title) + '</b>' +
          '<a class="cmp-rule" href="' + esc(res.specRef) + '" target="_blank" rel="noopener noreferrer">' + esc(res.id) + '</a></div>';
  if (res.message) h += '<div class="trace-detail">' + esc(CMP_LABEL[res.status]) + ': ' + esc(res.message) + '</div>';
  if (res.evidence !== undefined) {
    h += '<details class="cmp-evidence"><summary>Evidence</summary><pre>' + esc(JSON.stringify(res.evidence, null, 2)) + '</pre></details>';
  }
  return h + '</li>';
}
