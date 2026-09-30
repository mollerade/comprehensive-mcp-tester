/* ══════════════ DIAGNOSTICS ══════════════ */

function recordProbe(p) {
  diag.probes.push(p);
  if (diag.probes.length > diag.maxProbes) diag.probes.shift();
  updateBadges();
  if (state.activeTab === 'diag') renderTab();
}

function probeClass(p) {
  if (!p.ok) return 'fail';
  if (p.ms != null && p.ms > diag.slowMs) return 'slow';
  return 'ok';
}
function probeLabel(cls) {
  return cls === 'ok' ? 'OK' : cls === 'slow' ? 'Slow' : 'Failed';
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  var idx = Math.ceil(p * sorted.length) - 1;
  if (idx < 0) idx = 0;
  if (idx >= sorted.length) idx = sorted.length - 1;
  return sorted[idx];
}

function computeStats() {
  var ps = diag.probes;
  var total = ps.length, okCount = 0, slowCount = 0, failCount = 0;
  var lat = [], errCounts = {}, overheads = [];
  var curStreak = 0, maxStreak = 0, lastFailAt = null;

  for (var i = 0; i < total; i++) {
    var p = ps[i], c = probeClass(p);
    if (c === 'fail') {
      failCount++;
      var k = p.errorType || 'unknown';
      errCounts[k] = (errCounts[k] || 0) + 1;
      lastFailAt = p.t;
    } else {
      okCount++;
      if (c === 'slow') slowCount++;
      if (p.ms != null) lat.push(p.ms);
      if (p.overhead != null) overheads.push(p.overhead);
    }
  }
  for (var j = ps.length - 1; j >= 0; j--) {
    if (probeClass(ps[j]) === 'fail') curStreak++; else break;
  }
  var run = 0;
  for (var m = 0; m < ps.length; m++) {
    if (probeClass(ps[m]) === 'fail') { run++; if (run > maxStreak) maxStreak = run; }
    else run = 0;
  }

  lat.sort(function(a,b){ return a-b; });
  overheads.sort(function(a,b){ return a-b; });

  return {
    total: total, ok: okCount, slow: slowCount, fail: failCount,
    uptime: total ? (okCount / total) * 100 : null,
    p50: percentile(lat, 0.50), p95: percentile(lat, 0.95), p99: percentile(lat, 0.99),
    min: lat.length ? lat[0] : null, max: lat.length ? lat[lat.length-1] : null,
    medOverhead: percentile(overheads, 0.50),
    errCounts: errCounts, curStreak: curStreak, maxStreak: maxStreak, lastFailAt: lastFailAt
  };
}

function fmtMs(v) {
  if (v == null) return '\u2014';
  if (v >= 10000) return (v/1000).toFixed(1) + 's';
  if (v >= 1000) return (v/1000).toFixed(2) + 's';
  return Math.round(v) + 'ms';
}
function fmtClock(t) {
  var d = new Date(t);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

/* ── Monitor loop ── */
function onIntervalChange() {
  var v = parseInt(document.getElementById('monInterval').value, 10) || 0;
  diag.intervalMs = v;
  if (diag.running) { stopMonitor(); if (v) startMonitor(); }
  renderTab();
}
function onSlowChange() {
  var v = parseInt(document.getElementById('slowInput').value, 10);
  diag.slowMs = (isNaN(v) || v < 1) ? 2000 : v;
  renderTab();
}
function toggleMonitor() {
  if (diag.running) stopMonitor(); else startMonitor();
  renderTab();
}
function startMonitor() {
  var url = document.getElementById('urlInput').value.trim();
  if (!url) { showToast('Enter a server URL first', 'err'); return; }
  state.serverUrl = url;
  var iv = parseInt(document.getElementById('monInterval').value, 10) || 0;
  if (!iv) { showToast('Pick a probe interval first', 'err'); return; }
  diag.intervalMs = iv;
  diag.running = true;
  diag.startedAt = Date.now();
  doProbe();
  diag.monitorTimer = setInterval(doProbe, iv);
  updateLiveDot();
}
function stopMonitor() {
  diag.running = false;
  if (diag.monitorTimer) { clearInterval(diag.monitorTimer); diag.monitorTimer = null; }
  updateLiveDot();
}
function updateLiveDot() {
  document.getElementById('liveDot').innerHTML = diag.running ? '<span class="live-dot"></span>' : '';
}
function doProbe() {
  var sel = document.getElementById('probeMethod');
  var mode = sel ? sel.value : 'auto';
  if (sel) diag.probeMethod = mode;
  var method;
  if (mode === 'auto') method = state.connected ? 'tools/list' : 'initialize';
  else method = mode;

  var params = {};
  if (method === 'initialize') {
    params = { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: 'MCP Tester probe', version: CLIENT_INFO.version } };
  }
  rpc(method, params, 'probe');
}

function resetDiag() {
  diag.probes = [];
  updateBadges();
  renderTab();
}

/* ── Diagnostics rendering ── */
function renderDiagnostics() {
  var s = computeStats();
  var h = '';

  h += '<div class="monitor-bar">';
  h += '<div class="control-group">Probe every';
  h += '<select id="monInterval" onchange="onIntervalChange()">';
  var opts = [[0,'Off'],[5000,'5s'],[10000,'10s'],[30000,'30s'],[60000,'60s'],[300000,'5m']];
  for (var i = 0; i < opts.length; i++) {
    h += '<option value="' + opts[i][0] + '"' + (diag.intervalMs === opts[i][0] ? ' selected' : '') + '>' + opts[i][1] + '</option>';
  }
  h += '</select></div>';
  h += '<div class="control-group">Method<select id="probeMethod">';
  var pm = [['auto','Auto'],['server/discover','server/discover'],['initialize','initialize'],['tools/list','tools/list']];
  for (var j = 0; j < pm.length; j++) {
    h += '<option value="' + pm[j][0] + '"' + (diag.probeMethod === pm[j][0] ? ' selected' : '') + '>' + pm[j][1] + '</option>';
  }
  h += '</select></div>';
  h += '<div class="control-group">Slow above<input type="number" id="slowInput" value="' + diag.slowMs + '" min="1" step="100" onchange="onSlowChange()"></div>';
  h += '<button class="btn ' + (diag.running ? 'btn-stop' : 'btn-primary') + ' btn-sm" onclick="toggleMonitor()">' + (diag.running ? 'Stop monitor' : 'Start monitor') + '</button>';
  h += '<div class="control-group" style="margin-left:auto">';
  h += '<button class="btn btn-ghost btn-sm" onclick="doProbe()">Probe now</button>';
  h += '<button class="btn btn-ghost btn-sm" onclick="exportReport()">Export report</button>';
  h += '<button class="btn btn-ghost btn-sm" onclick="resetDiag()">Reset</button>';
  h += '</div></div>';

  if (!s.total) {
    h += '<div class="empty-state">No samples yet \u2014 start the monitor, or just use the Tools tab and every call is recorded here</div>';
    return h;
  }

  var upClass = s.uptime >= 99 ? 'st-ok' : s.uptime >= 90 ? 'st-slow' : 'st-fail';
  h += '<div class="diag-section"><div class="kpi-row">';
  h += kpi('Success rate', (s.uptime != null ? s.uptime.toFixed(1) : '\u2014'), '%', s.ok + ' of ' + s.total + ' samples', upClass);
  h += kpi('Median latency', fmtMs(s.p50), '', 'p95 ' + fmtMs(s.p95) + ' \u00b7 p99 ' + fmtMs(s.p99), '');
  h += kpi('Slow responses', String(s.slow), '', 'over ' + fmtMs(diag.slowMs), s.slow ? 'st-slow' : '');
  h += kpi('Failures', String(s.fail), '',
           s.curStreak ? (s.curStreak + ' in a row right now') : (s.maxStreak ? ('worst run ' + s.maxStreak) : 'no failures'),
           s.fail ? 'st-fail' : '');
  h += '</div></div>';

  h += '<div class="diag-section">';
  h += '<div class="diag-title">Probe timeline <span class="sub">oldest to newest, last ' + Math.min(STRIP_MAX, s.total) + ' samples</span></div>';
  h += '<div class="chart-card"><div class="strip-scroll"><div class="strip" id="stripEl">';
  var start = Math.max(0, diag.probes.length - STRIP_MAX);
  for (var k = start; k < diag.probes.length; k++) {
    var p = diag.probes[k], c = probeClass(p);
    h += '<div class="strip-cell ' + c + '" data-i="' + k + '" ' +
         'onmouseenter="showProbeTip(event,' + k + ')" onmouseleave="hideTip()" ' +
         'onclick="showProbeTip(event,' + k + ')"></div>';
  }
  h += '</div></div>';
  h += '<div class="legend">';
  h += '<span class="legend-item"><span class="legend-swatch" style="background:var(--st-ok)"></span>OK (under ' + fmtMs(diag.slowMs) + ')</span>';
  h += '<span class="legend-item"><span class="legend-swatch" style="background:var(--st-slow)"></span>Slow</span>';
  h += '<span class="legend-item"><span class="legend-swatch" style="background:var(--st-fail)"></span>Failed</span>';
  h += '</div></div></div>';

  h += '<div class="diag-section">';
  h += '<div class="diag-title">Response time <span class="sub">successful samples; failures marked on the baseline</span></div>';
  h += '<div class="chart-card">' + renderLatencyChart(s) + '</div></div>';

  h += '<div class="diag-section">';
  h += '<div class="diag-title">Failure breakdown</div>';
  h += '<div class="chart-card">' + renderBreakdown(s) + '</div></div>';

  return h;
}

function kpi(label, value, unit, note, cls) {
  return '<div class="kpi-tile"><div class="kpi-label">' + esc(label) + '</div>' +
         '<div class="kpi-value ' + cls + '">' + esc(value) + (unit ? '<span class="unit">' + esc(unit) + '</span>' : '') + '</div>' +
         '<div class="kpi-note">' + esc(note) + '</div></div>';
}

function renderLatencyChart(s) {
  var W = 600, H = 150, padL = 44, padR = 10, padT = 12, padB = 20;
  var ps = diag.probes;
  if (!ps.length) return '<div class="empty-state">No samples</div>';

  var dataMax = s.max != null ? s.max : 1;
  if (diag.slowMs > dataMax) dataMax = diag.slowMs;
  if (dataMax <= 0) dataMax = 1;

  // Round the axis up to a readable step (1/2/2.5/5 x 10^n) so ticks land
  // on values a human can compare against.
  var rawStep = (dataMax * 1.05) / 3;
  var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
  var norm = rawStep / mag;
  var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  var tickCount = Math.max(1, Math.ceil((dataMax * 1.05) / step));
  var maxV = step * tickCount;

  var n = ps.length;
  var plotW = W - padL - padR, plotH = H - padT - padB;
  function xOf(i) { return padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW); }
  function yOf(v) { return padT + plotH - (v / maxV) * plotH; }

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" role="img" aria-label="Response time over time">';

  for (var g = 0; g <= tickCount; g++) {
    var val = step * g, y = yOf(val);
    svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--viz-grid)" stroke-width="1"/>';
    svg += '<text x="' + (padL - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="var(--viz-muted)" font-family="ui-monospace,monospace">' + fmtMs(val) + '</text>';
  }

  if (diag.slowMs < maxV) {
    var ty = yOf(diag.slowMs);
    svg += '<line x1="' + padL + '" y1="' + ty.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + ty.toFixed(1) + '" stroke="var(--st-slow)" stroke-width="1.5" stroke-dasharray="4 3"/>';
    svg += '<text x="' + (W - padR) + '" y="' + (ty - 4).toFixed(1) + '" text-anchor="end" font-size="9" fill="var(--st-slow)" font-family="ui-monospace,monospace">slow threshold</text>';
  }

  // Split successes into runs, breaking across failures rather than
  // interpolating over an outage. A run of one renders as a dot —
  // otherwise isolated successes between failures would be invisible.
  var segs = [], cur = [];
  for (var i = 0; i < n; i++) {
    if (ps[i].ok && ps[i].ms != null) cur.push(i);
    else { if (cur.length) segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);

  for (var sgi = 0; sgi < segs.length; sgi++) {
    var seg = segs[sgi];
    if (seg.length === 1) {
      var si = seg[0];
      svg += '<circle cx="' + xOf(si).toFixed(1) + '" cy="' + yOf(ps[si].ms).toFixed(1) + '" r="2.5" fill="var(--viz-line)"/>';
    } else {
      var d = '';
      for (var q = 0; q < seg.length; q++) {
        d += (q ? 'L' : 'M') + xOf(seg[q]).toFixed(1) + ' ' + yOf(ps[seg[q]].ms).toFixed(1) + ' ';
      }
      svg += '<path d="' + d.trim() + '" fill="none" stroke="var(--viz-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      var last = seg[seg.length - 1];
      svg += '<circle cx="' + xOf(last).toFixed(1) + '" cy="' + yOf(ps[last].ms).toFixed(1) + '" r="2" fill="var(--viz-line)"/>';
    }
  }

  var baseY = padT + plotH;
  for (var f = 0; f < n; f++) {
    if (!ps[f].ok) {
      svg += '<rect x="' + (xOf(f) - 1.5).toFixed(1) + '" y="' + (baseY - 9) + '" width="3" height="9" rx="1.5" fill="var(--st-fail)"/>';
    }
  }

  svg += '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '" stroke="var(--viz-axis)" stroke-width="1"/>';
  svg += '<text x="' + padL + '" y="' + (H - 6) + '" font-size="9" fill="var(--viz-muted)" font-family="ui-monospace,monospace">' + fmtClock(ps[0].t) + '</text>';
  if (n > 1) {
    svg += '<text x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end" font-size="9" fill="var(--viz-muted)" font-family="ui-monospace,monospace">' + fmtClock(ps[n-1].t) + '</text>';
  }
  svg += '</svg>';

  var note = '<div style="font-size:11px;color:var(--ink-muted);margin-top:8px">';
  note += 'Range ' + fmtMs(s.min) + ' \u2013 ' + fmtMs(s.max);
  if (s.medOverhead != null) note += ' \u00b7 median proxy overhead ' + fmtMs(s.medOverhead) + ' (browser\u2192Worker; the rest is the origin)';
  note += '</div>';
  return svg + note;
}

function renderBreakdown(s) {
  var keys = Object.keys(s.errCounts);
  if (!keys.length) {
    return '<div style="font-size:12px;color:var(--ink-muted);padding:4px 0">No failures recorded in this window.</div>';
  }
  keys.sort(function(a,b){ return s.errCounts[b] - s.errCounts[a]; });
  var labels = {
    timeout: 'Timed out (no response before the deadline)',
    network: 'Network / connection failure reaching the origin',
    http5xx: 'HTTP 5xx from the origin',
    http4xx: 'HTTP 4xx from the origin',
    jsonrpc: 'JSON-RPC error in an HTTP 200 response',
    client:  'Failure between the browser and the Worker',
    unknown: 'Unclassified'
  };
  var h = '<table class="breakdown"><thead><tr><th>Failure type</th><th style="text-align:right">Count</th><th style="text-align:right">Share</th></tr></thead><tbody>';
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], c = s.errCounts[k];
    h += '<tr><td><span class="err-dot" style="background:var(--st-fail)"></span>' + esc(labels[k] || k) + '</td>' +
         '<td class="num">' + c + '</td>' +
         '<td class="num">' + ((c / s.total) * 100).toFixed(1) + '%</td></tr>';
  }
  h += '</tbody></table>';

  for (var j = diag.probes.length - 1; j >= 0; j--) {
    var p = diag.probes[j];
    if (!p.ok) {
      h += '<div style="margin-top:10px;font-size:11px;color:var(--ink-muted)">Most recent: <span style="font-family:var(--font-mono);color:var(--ink)">' +
           esc(p.method) + '</span> at ' + fmtClock(p.t) +
           (p.errorDetail ? ' \u2014 ' + esc(String(p.errorDetail)) : '') + '</div>';
      break;
    }
  }
  return h;
}

/* ── Tooltip ── */
function showProbeTip(ev, i) {
  var p = diag.probes[i];
  if (!p) return;
  var c = probeClass(p);
  var color = c === 'ok' ? 'var(--st-ok)' : c === 'slow' ? 'var(--st-slow)' : 'var(--st-fail)';
  var h = '<div class="tt-head"><span class="legend-swatch" style="background:' + color + '"></span>' + probeLabel(c) + '</div>';
  h += fmtClock(p.t) + ' \u00b7 ' + esc(p.method) + '<br>';
  if (p.status != null) h += 'HTTP ' + p.status + '<br>';
  if (p.ms != null) h += 'origin ' + fmtMs(p.ms);
  if (p.ttfb != null) h += ' (ttfb ' + fmtMs(p.ttfb) + ')';
  if (p.ms != null) h += '<br>';
  if (p.overhead != null) h += 'proxy overhead ' + fmtMs(p.overhead) + '<br>';
  if (p.attempts > 1) h += 'attempts ' + p.attempts + '<br>';
  if (p.colo) h += 'colo ' + esc(p.colo) + '<br>';
  if (p.errorDetail) h += '<span style="color:var(--st-fail)">' + esc(String(p.errorDetail)) + '</span>';

  var tip = document.getElementById('vizTooltip');
  tip.innerHTML = h;
  tip.hidden = false;
  var x = ev.clientX + 12, y = ev.clientY + 12;
  var r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 12;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 12;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function hideTip() { document.getElementById('vizTooltip').hidden = true; }

/* ── Export ── */
/** Text safe inside a Markdown table cell: backslashes first, then pipes */
function mdCell(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function exportReport() {
  var s = computeStats();
  if (!s.total) { showToast('No samples to export yet', 'err'); return; }
  var L = [];
  L.push('# MCP Diagnostic Report');
  L.push('');
  L.push('- Target: ' + (state.serverUrl || '(none)'));
  L.push('- Transport: ' + state.transport);
  L.push('- Generated: ' + new Date().toISOString());
  L.push('- Window: ' + s.total + ' samples, ' + fmtClock(diag.probes[0].t) + ' to ' + fmtClock(diag.probes[diag.probes.length-1].t));
  L.push('- Timeout: ' + getTimeout() + 'ms, retries: ' + getRetries() + ', slow threshold: ' + diag.slowMs + 'ms');
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('- Success rate: ' + (s.uptime != null ? s.uptime.toFixed(2) : '-') + '% (' + s.ok + '/' + s.total + ')');
  L.push('- Latency p50/p95/p99: ' + fmtMs(s.p50) + ' / ' + fmtMs(s.p95) + ' / ' + fmtMs(s.p99));
  L.push('- Range: ' + fmtMs(s.min) + ' to ' + fmtMs(s.max));
  L.push('- Slow responses (over ' + fmtMs(diag.slowMs) + '): ' + s.slow);
  L.push('- Failures: ' + s.fail + ' (worst consecutive run: ' + s.maxStreak + ')');
  if (s.medOverhead != null) L.push('- Median proxy overhead: ' + fmtMs(s.medOverhead));
  L.push('');
  L.push('## Failures by type');
  L.push('');
  var ek = Object.keys(s.errCounts);
  if (!ek.length) L.push('None.');
  else for (var i = 0; i < ek.length; i++) L.push('- ' + ek[i] + ': ' + s.errCounts[ek[i]]);
  L.push('');
  L.push('## Samples');
  L.push('');
  L.push('| # | time | method | status | origin ms | ttfb ms | overhead ms | colo | outcome | detail |');
  L.push('|---|------|--------|--------|-----------|---------|-------------|------|---------|--------|');
  for (var j = 0; j < diag.probes.length; j++) {
    var p = diag.probes[j];
    L.push('| ' + (j+1) + ' | ' + fmtClock(p.t) + ' | ' + p.method + ' | ' + (p.status != null ? p.status : '-') +
           ' | ' + (p.ms != null ? Math.round(p.ms) : '-') +
           ' | ' + (p.ttfb != null ? Math.round(p.ttfb) : '-') +
           ' | ' + (p.overhead != null ? Math.round(p.overhead) : '-') +
           ' | ' + (p.colo || '-') +
           ' | ' + probeLabel(probeClass(p)) +
           ' | ' + (p.errorDetail ? mdCell(p.errorDetail) : '') + ' |');
  }
  L.push('');
  L.push('## Raw JSON');
  L.push('');
  L.push('\u0060\u0060\u0060json');
  L.push(JSON.stringify({ target: state.serverUrl, transport: state.transport, stats: s, probes: diag.probes }, null, 2));
  L.push('\u0060\u0060\u0060');

  var blob = new Blob([L.join('\n')], { type: 'text/markdown' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mcp-diagnostics-' + new Date().toISOString().replace(/[:.]/g,'-').slice(0,19) + '.md';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

