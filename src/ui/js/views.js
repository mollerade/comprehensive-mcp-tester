/* ══════════════ UI ══════════════ */
function setStatus(cls, text) {
  document.getElementById('statusPill').className = 'status-pill ' + cls;
  document.getElementById('statusText').textContent = text;
}
function updateBadges() {
  document.getElementById('toolsBadge').textContent = state.tools.length;
  document.getElementById('resourcesBadge').textContent = state.resources.length;
  document.getElementById('promptsBadge').textContent = state.prompts.length;
  document.getElementById('logBadge').textContent = state.log.length;
  document.getElementById('diagBadge').textContent = diag.probes.length;
}

function switchTab(tab) {
  state.activeTab = tab;
  var btns = document.querySelectorAll('.tab-btn');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === tab);
  renderTab();
}

function renderTab() {
  var ct = document.getElementById('tabContent');
  if (state.activeTab === 'log') { ct.innerHTML = renderLog(); return; }
  if (state.activeTab === 'diag') { ct.innerHTML = renderDiagnostics(); return; }
  if (!state.connected) {
    ct.innerHTML = '<div class="empty-state"><svg width="36" height="36" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M14 20h12M20 14v12" stroke="var(--ink)" stroke-width="1.5" stroke-linecap="round"/></svg>Enter a server URL, pick a transport, and connect</div>';
    return;
  }
  var items = listFor(state.activeTab);
  if (!items.length) { ct.innerHTML = '<div class="empty-state">No ' + state.activeTab + ' found on this server</div>'; return; }

  var tab = state.activeTab;
  var noun = tab === 'tools' ? 'tools' : tab === 'resources' ? 'resources' : 'prompts';
  var f = state.filters[tab] || '';
  var html = '<div class="filter-bar">';
  html += '<div class="filter-input"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14" stroke-linecap="round"/></svg>';
  html += '<input type="text" id="listFilter" placeholder="Filter ' + noun + ' by name or description\u2026" spellcheck="false" autocapitalize="none" value="' + esc(f) + '" oninput="onFilterInput()">';
  html += f ? '<button class="filter-clear" onclick="clearFilter()" aria-label="Clear filter">&#10005;</button>' : '';
  html += '</div><span class="filter-count" id="filterCount"></span></div>';
  html += '<div id="itemListWrap">' + renderItemList(tab) + '</div>';
  ct.innerHTML = html;
  updateFilterCount();
  hydrateExpanded();
}

function listFor(tab) {
  return tab === 'tools' ? state.tools : tab === 'resources' ? state.resources : state.prompts;
}
function typeFor(tab) {
  return tab === 'tools' ? 'tool' : tab === 'resources' ? 'resource' : 'prompt';
}
function matchesFilter(item, q) {
  if (!q) return true;
  q = q.toLowerCase();
  var name = (item.name || item.uri || '').toLowerCase();
  var desc = (item.description || '').toLowerCase();
  return name.indexOf(q) !== -1 || desc.indexOf(q) !== -1;
}

/* Render the list; each card keeps its ORIGINAL index so invoke handlers stay valid */
function renderItemList(tab) {
  var items = listFor(tab), type = typeFor(tab), q = state.filters[tab] || '';
  var shown = 0, html = '<div class="item-list">';
  for (var i = 0; i < items.length; i++) {
    if (!matchesFilter(items[i], q)) continue;
    shown++;
    var item = items[i], name = item.name || item.uri || ('Item ' + i), desc = item.description || '';
    var isExp = state.expandedItem === (type + '-' + i);
    html += '<div class="item-card' + (isExp ? ' expanded' : '') + '" onclick="toggleItem(\'' + type + '\',' + i + ')">';
    html += '<div class="item-card-header"><span class="item-card-name">' + esc(name) + '</span><span class="item-card-type type-' + type + '">' + type + '</span></div>';
    if (desc) html += '<div class="item-card-desc">' + esc(desc) + '</div>';
    if (isExp) html += renderDetail(type, item, i);
    html += '</div>';
  }
  html += '</div>';
  if (shown === 0) html = '<div class="empty-state">No ' + type + 's match \u201c' + esc(q) + '\u201d</div>';
  return html;
}

function onFilterInput() {
  var el = document.getElementById('listFilter');
  if (!el) return;
  state.filters[state.activeTab] = el.value;
  state.expandedItem = null;
  // update only the list + count so the input keeps focus and caret
  document.getElementById('itemListWrap').innerHTML = renderItemList(state.activeTab);
  updateFilterCount();
  // toggle the clear button without a full re-render
  var wrap = el.parentElement, existing = wrap.querySelector('.filter-clear');
  if (el.value && !existing) {
    var b = document.createElement('button');
    b.className = 'filter-clear'; b.innerHTML = '&#10005;'; b.setAttribute('aria-label','Clear filter');
    b.onclick = clearFilter; wrap.appendChild(b);
  } else if (!el.value && existing) existing.remove();
}
function clearFilter() {
  state.filters[state.activeTab] = '';
  state.expandedItem = null;
  renderTab();
  var el = document.getElementById('listFilter'); if (el) el.focus();
}
function updateFilterCount() {
  var tab = state.activeTab, items = listFor(tab), q = state.filters[tab] || '';
  var total = items.length, shown = total;
  if (q) { shown = 0; for (var i = 0; i < items.length; i++) if (matchesFilter(items[i], q)) shown++; }
  var el = document.getElementById('filterCount');
  if (el) el.textContent = q ? (shown + ' of ' + total) : (total + ' ' + typeFor(tab) + (total === 1 ? '' : 's'));
}

function toggleItem(type, idx) {
  var key = type + '-' + idx;
  state.expandedItem = state.expandedItem === key ? null : key;
  renderTab();
}
function renderDetail(type, item, idx) {
  if (type === 'tool') return renderToolDetail(item, idx);
  if (type === 'resource') return renderResourceDetail(item, idx);
  return renderPromptDetail(item, idx);
}

/* ── Tool detail: Form / JSON editor with suggested request ── */
function renderToolDetail(tool, idx) {
  var key = 'tool-' + idx;
  var d = getDraft(key);
  var schema = tool.inputSchema || {}, props = schema.properties || {}, req = schema.required || [];
  var keys = Object.keys(props);
  var html = '<div class="detail-panel" onclick="event.stopPropagation()">';

  if (tool.inputSchema) {
    html += '<details class="schema-details schema-section"><summary>Input schema</summary><div class="result-box">' + esc(JSON.stringify(tool.inputSchema, null, 2)) + '</div></details>';
  }

  html += '<div class="mode-tabs">';
  html += '<button class="mode-tab' + (d.mode === 'form' ? ' active' : '') + '" onclick="setMode(\'' + key + '\',\'form\')">Form</button>';
  html += '<button class="mode-tab' + (d.mode === 'json' ? ' active' : '') + '" onclick="setMode(\'' + key + '\',\'json\')">JSON request</button>';
  html += '</div>';

  // Form mode
  html += '<div id="form-' + key + '"' + (d.mode === 'json' ? ' hidden' : '') + '>';
  if (keys.length) {
    for (var j = 0; j < keys.length; j++) {
      var n = keys[j], p = props[n], pt = p.type || 'string', isObj = pt === 'object' || pt === 'array';
      var reqd = req.indexOf(n) !== -1;
      html += '<div class="param-row"><div class="param-name">' + esc(n);
      html += '<span class="param-type">' + esc(String(pt)) + '</span>';
      html += '<span class="param-tag ' + (reqd ? 'req' : 'opt') + '">' + (reqd ? 'required' : 'optional') + '</span></div>';
      if (p.description) html += '<div class="param-desc">' + esc(p.description) + '</div>';
      // The property name is server-controlled, so it must be escaped before it enters
      // the id attribute (esc() neutralises " < > & in a double-quoted value). The browser
      // decodes the entities back, so getElementById() still matches the raw name.
      var inputId = 'param-' + idx + '-' + n, idAttr = esc(inputId);
      if (isObj) html += '<textarea class="param-input" id="' + idAttr + '" rows="3" oninput="saveFormDraft(\'' + key + '\',' + idx + ')"></textarea>';
      else if (pt === 'boolean') html += '<select class="param-input" id="' + idAttr + '" style="appearance:auto" onchange="saveFormDraft(\'' + key + '\',' + idx + ')"><option value="">-</option><option value="true">true</option><option value="false">false</option></select>';
      else html += '<input class="param-input" id="' + idAttr + '" type="' + (pt === 'number' || pt === 'integer' ? 'number' : 'text') + '" oninput="saveFormDraft(\'' + key + '\',' + idx + ')">';
      html += '</div>';
    }
  } else {
    html += '<div style="font-size:12px;color:var(--ink-muted);margin-bottom:8px">This tool takes no parameters.</div>';
  }
  html += '</div>';

  // JSON mode: the full editable JSON-RPC request
  html += '<div id="json-' + key + '"' + (d.mode === 'form' ? ' hidden' : '') + '>';
  html += '<textarea class="param-input json-editor" id="jsonta-' + key + '" spellcheck="false" oninput="onJsonEdit(\'' + key + '\')"></textarea>';
  html += '<div class="json-hint" id="jsonhint-' + key + '">Full JSON-RPC request \u2014 edit anything; "id" is assigned automatically at send.</div>';
  html += '</div>';

  html += '<div class="detail-actions">';
  html += '<button class="btn btn-primary" onclick="invokeTool(' + idx + ')" id="invoke-' + idx + '">Execute</button>';
  html += '<button class="btn btn-ghost btn-sm" onclick="resetSuggestion(\'' + key + '\',' + idx + ')">Reset to suggested</button>';
  html += '</div>';

  html += '<div class="result-area" id="rr-' + key + '"></div></div>';
  return html;
}

function renderResourceDetail(res, idx) {
  var key = 'resource-' + idx;
  var html = '<div class="detail-panel" onclick="event.stopPropagation()">';
  if (res.uri) html += '<div class="schema-section"><div class="schema-label">URI</div><div class="result-box">' + esc(res.uri) + '</div></div>';
  if (res.mimeType) html += '<div style="font-size:11px;color:var(--ink-muted)">Type: ' + esc(res.mimeType) + '</div>';
  html += '<div class="detail-actions"><button class="btn btn-primary btn-sm" onclick="readResource(' + idx + ')" id="read-res-' + idx + '">Read</button></div>';
  html += '<div class="result-area" id="rr-' + key + '"></div></div>';
  return html;
}

function renderPromptDetail(prompt, idx) {
  var key = 'prompt-' + idx;
  var args = prompt.arguments || [], html = '<div class="detail-panel" onclick="event.stopPropagation()">';
  if (args.length) {
    html += '<div class="schema-section"><div class="schema-label">Arguments</div>';
    for (var j = 0; j < args.length; j++) {
      var areqd = !!args[j].required;
      html += '<div class="param-row"><div class="param-name">' + esc(args[j].name);
      html += '<span class="param-tag ' + (areqd ? 'req' : 'opt') + '">' + (areqd ? 'required' : 'optional') + '</span>';
      html += '</div>';
      if (args[j].description) html += '<div class="param-desc">' + esc(args[j].description) + '</div>';
      // The argument name is server-controlled, so escape it before it enters the id attribute.
      html += '<input class="param-input" id="prompt-' + idx + '-' + esc(args[j].name) + '" type="text"></div>';
    }
    html += '</div>';
  }
  html += '<div class="detail-actions"><button class="btn btn-primary btn-sm" onclick="getPrompt(' + idx + ')" id="get-prompt-' + idx + '">Get Prompt</button></div>';
  html += '<div class="result-area" id="rr-' + key + '"></div></div>';
  return html;
}

/* ── Hydration: fill values after innerHTML render (avoids attribute-escaping
   of arbitrary JSON, and restores drafts across re-renders) ── */
function hydrateExpanded() {
  var exp = state.expandedItem;
  if (!exp) return;
  var parts = exp.split('-'), type = parts[0], idx = parseInt(parts[1], 10);
  var key = exp;
  var d = getDraft(key);

  if (type === 'tool') {
    var tool = state.tools[idx];
    if (!tool) return;
    var schema = tool.inputSchema || {}, props = schema.properties || {};
    var vals = d.formVals || suggestedFormVals(schema);
    var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var el = document.getElementById('param-' + idx + '-' + keys[i]);
      if (!el) continue;
      var v = vals[keys[i]];
      if (v !== undefined && v !== null && v !== '') el.value = v;
      else {
        var sug = suggestValue(props[keys[i]], 0);
        if (sug !== null && sug !== undefined) {
          el.placeholder = typeof sug === 'object' ? JSON.stringify(sug) : String(sug);
        }
      }
    }
    var ta = document.getElementById('jsonta-' + key);
    if (ta) ta.value = d.jsonDirty && d.jsonText != null ? d.jsonText : suggestedJson(idx);
    renderReqRes(key);
  } else if (type === 'prompt') {
    renderReqRes(key);
  } else {
    renderReqRes(key);
  }
}

/* form values that a fresh suggestion would produce (strings, for inputs) */
function suggestedFormVals(schema) {
  var out = {}, args = suggestArgs(schema);
  var ks = Object.keys(args);
  for (var i = 0; i < ks.length; i++) {
    var v = args[ks[i]];
    out[ks[i]] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : (v === null ? '' : String(v));
  }
  return out;
}

function suggestedJson(idx) {
  var tool = state.tools[idx];
  var body = { jsonrpc: '2.0', id: '(auto)', method: 'tools/call',
               params: { name: tool.name, arguments: collectFormArgs(idx) } };
  return JSON.stringify(body, null, 2);
}

function collectFormArgs(idx) {
  var tool = state.tools[idx], schema = tool.inputSchema || {}, props = schema.properties || {}, args = {};
  var keys = Object.keys(props);
  var d = state.drafts['tool-' + idx];
  var vals = (d && d.formVals) || suggestedFormVals(schema);
  for (var i = 0; i < keys.length; i++) {
    var raw = vals[keys[i]];
    if (raw === undefined || raw === null || raw === '') continue;
    var pt = props[keys[i]].type, val = raw;
    if (pt === 'number' || pt === 'integer') val = Number(raw);
    else if (pt === 'boolean') val = raw === 'true' || raw === true;
    else if (pt === 'object' || pt === 'array') { try { val = JSON.parse(raw); } catch(e) {} }
    args[keys[i]] = val;
  }
  return args;
}

function saveFormDraft(key, idx) {
  var d = getDraft(key);
  var tool = state.tools[idx], props = (tool.inputSchema || {}).properties || {};
  var vals = {}, keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var el = document.getElementById('param-' + idx + '-' + keys[i]);
    if (el) vals[keys[i]] = el.value;
  }
  d.formVals = vals;
}

function setMode(key, mode) {
  var d = getDraft(key);
  d.mode = mode;
  var idx = parseInt(key.split('-')[1], 10);
  if (mode === 'json' && !d.jsonDirty) d.jsonText = suggestedJson(idx);
  renderTab();
}

function onJsonEdit(key) {
  var d = getDraft(key);
  var ta = document.getElementById('jsonta-' + key);
  d.jsonText = ta.value;
  d.jsonDirty = true;
  var hint = document.getElementById('jsonhint-' + key);
  try {
    JSON.parse(ta.value);
    ta.classList.remove('invalid');
    hint.className = 'json-hint';
    hint.textContent = 'Full JSON-RPC request \u2014 edit anything; "id" is assigned automatically at send.';
  } catch(e) {
    ta.classList.add('invalid');
    hint.className = 'json-hint err';
    hint.textContent = 'Invalid JSON: ' + e.message;
  }
}

function resetSuggestion(key, idx) {
  var d = getDraft(key);
  d.formVals = null; d.jsonText = null; d.jsonDirty = false;
  renderTab();
  showToast('Reset to suggested request');
}

/* ── Request / response panel ── */
function renderReqRes(key) {
  var d = state.drafts[key];
  var el = document.getElementById('rr-' + key);
  if (!el || !d || !d.lastReq) { if (el) el.innerHTML = ''; return; }
  var h = '';
  var m = d.lastMeta || {};
  h += '<div class="rr-meta">';
  if (m.status != null && m.status !== 0) h += '<span class="http-status ' + statusClass(m.status) + '">' + m.status + '</span>';
  else if (m.status === 0) h += '<span class="http-status snet">NET</span>';
  if (m.ms != null) h += '<span>' + fmtMs(m.ms) + ' origin</span>';
  if (m.clientMs != null) h += '<span>' + fmtMs(m.clientMs) + ' round trip</span>';
  if (m.at) h += '<span>' + fmtClock(m.at) + '</span>';
  h += '</div>';
  var resErr = d.lastRes && d.lastRes.error;
  h += '<div class="rr-block rr-req">';
  h += '<div class="rr-head"><span class="rr-tag req">Request</span><span class="rr-dir">browser \u2192 server</span><button class="copy-btn" onclick="copyFromStore(\'' + key + '\',\'req\')">Copy</button></div>';
  h += '<div class="result-box">' + esc(JSON.stringify(d.lastReq, null, 2)) + '</div></div>';
  if (d.lastRes !== undefined) {
    h += '<div class="rr-block ' + (resErr ? 'rr-err' : 'rr-res') + '">';
    h += '<div class="rr-head"><span class="rr-tag ' + (resErr ? 'err' : 'res') + '">Response</span><span class="rr-dir">server \u2192 browser</span><button class="copy-btn" onclick="copyFromStore(\'' + key + '\',\'res\')">Copy</button></div>';
    h += '<div class="result-box">' + esc(JSON.stringify(d.lastRes, null, 2)) + '</div></div>';
  }
  el.innerHTML = h;
}

/* Shared invoke path: send, store req/res on the draft, render the panel */
function runAndShow(key, body, btnId, btnLabel) {
  var d = getDraft(key);
  d.lastReq = body; d.lastRes = undefined; d.lastMeta = null;
  renderReqRes(key);
  var btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
  return sendBody(body, 'call').then(function(r) {
    if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
    d.lastRes = r.data;
    d.lastMeta = { status: r.status, ms: r.diag ? r.diag.totalMs : null, clientMs: r.clientMs, at: Date.now() };
    renderReqRes(key);
    return r;
  });
}

/* ── Invoke ── */
function invokeTool(idx) {
  var key = 'tool-' + idx;
  var d = getDraft(key);
  var body;
  if (d.mode === 'json') {
    var ta = document.getElementById('jsonta-' + key);
    try { body = JSON.parse(ta.value); }
    catch(e) { showToast('Fix the JSON first: ' + e.message, 'err'); return; }
    if (!body.jsonrpc) body.jsonrpc = '2.0';
    if (!body.method) body.method = 'tools/call';
    var isNotif = String(body.method).indexOf('notifications/') === 0;
    if (isNotif) { delete body.id; }
    else if (body.id === '(auto)' || body.id === undefined || body.id === null) body.id = ++state.rpcId;
  } else {
    saveFormDraft(key, idx);
    body = buildBody('tools/call', { name: state.tools[idx].name, arguments: collectFormArgs(idx) });
  }
  runAndShow(key, body, 'invoke-' + idx, 'Execute');
}

function readResource(idx) {
  var key = 'resource-' + idx;
  var body = buildBody('resources/read', { uri: state.resources[idx].uri });
  runAndShow(key, body, 'read-res-' + idx, 'Read');
}

function getPrompt(idx) {
  var key = 'prompt-' + idx;
  var prompt = state.prompts[idx], args = {}, pArgs = prompt.arguments || [];
  for (var i = 0; i < pArgs.length; i++) {
    var el = document.getElementById('prompt-' + idx + '-' + pArgs[i].name);
    if (el && el.value.trim()) args[pArgs[i].name] = el.value.trim();
  }
  var body = buildBody('prompts/get', { name: prompt.name, arguments: args });
  runAndShow(key, body, 'get-prompt-' + idx, 'Get Prompt');
}

