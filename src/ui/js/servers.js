/* ── Saved servers: one editor, three entry points (bookmark, edit, + New) ── */
var editingServerIdx = -1;

function renderServers() {
  var list = document.getElementById('serverList');
  if (!state.servers.length) { list.innerHTML = '<div style="padding:10px 8px;font-size:11px;color:var(--ink-muted)">Nothing saved yet \u2014 use the bookmark button next to the URL.</div>'; return; }
  var html = '';
  for (var i = 0; i < state.servers.length; i++) {
    var s = state.servers[i];
    html += '<div class="server-item' + (state.activeServerId === i ? ' active' : '') + '" onclick="selectServer(' + i + ')" role="button" tabindex="0">';
    html += '<span class="server-name">' + esc(s.name || s.url) + '</span>';
    html += '<button class="row-btn" onclick="event.stopPropagation();openEditorFor(' + i + ')" title="Edit" aria-label="Edit server">&#9998;</button>';
    html += '<button class="row-btn" onclick="event.stopPropagation();deleteServer(' + i + ')" title="Delete" aria-label="Delete server">&#10005;</button></div>';
  }
  list.innerHTML = html;
}
function selectServer(idx) {
  state.activeServerId = idx;
  var s = state.servers[idx];
  document.getElementById('urlInput').value = s.url;
  state.headers = s.headers || {};
  renderServers(); renderHdrCount(); renderSaveBtn(); persistCurrent();
  if (window.innerWidth <= 700) toggleSidebar();
}
function deleteServer(idx) {
  state.servers.splice(idx, 1);
  if (state.activeServerId === idx) state.activeServerId = null;
  else if (state.activeServerId > idx) state.activeServerId--;
  persistServers(); renderServers(); renderSaveBtn();
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('collapsed'); }

function openEditor(idx, prefill) {
  editingServerIdx = idx;
  document.getElementById('serverModalTitle').textContent = idx === -1 ? 'Save Server' : 'Edit Server';
  document.getElementById('modalName').value = prefill.name || '';
  document.getElementById('modalUrl').value = prefill.url || '';
  document.getElementById('modalHeaders').value = (prefill.headers && Object.keys(prefill.headers).length) ? JSON.stringify(prefill.headers, null, 2) : '';
  document.getElementById('serverModal').hidden = false;
}
function openEditorForCurrent() {
  var url = document.getElementById('urlInput').value.trim();
  var idx = url ? findSavedIndex(url) : -1;
  if (idx !== -1) { openEditorFor(idx); return; }
  openEditor(-1, { url: url, headers: state.headers });
}
function openEditorFor(idx) { openEditor(idx, state.servers[idx]); }
function openEditorNew() { openEditor(-1, {}); }
function hideServerModal() { document.getElementById('serverModal').hidden = true; }

function saveServerFromModal() {
  var name = document.getElementById('modalName').value.trim();
  var url = document.getElementById('modalUrl').value.trim();
  if (!url) { showToast('URL is required', 'err'); return; }
  var headers = {}, hVal = document.getElementById('modalHeaders').value.trim();
  if (hVal) { try { headers = JSON.parse(hVal); } catch(e) { showToast('Headers must be valid JSON', 'err'); return; } }
  var entry = { name: name || url, url: url, transport: 'streamable', headers: headers };
  if (editingServerIdx === -1) {
    state.servers.push(entry);
    state.activeServerId = state.servers.length - 1;
  } else {
    state.servers[editingServerIdx] = entry;
  }
  persistServers(); renderServers(); renderSaveBtn(); hideServerModal();
  showToast('Saved');
}

/* ── Headers modal ── */
function showHeadersModal() {
  document.getElementById('headersText').value = Object.keys(state.headers).length ? JSON.stringify(state.headers, null, 2) : '';
  document.getElementById('headersModal').hidden = false;
}
function hideHeadersModal() { document.getElementById('headersModal').hidden = true; }
function saveHeaders() {
  var v = document.getElementById('headersText').value.trim();
  if (!v) { state.headers = {}; }
  else {
    try { state.headers = JSON.parse(v); } catch(e) { showToast('Headers must be valid JSON', 'err'); return; }
  }
  renderHdrCount(); hideHeadersModal(); persistCurrent();
  showToast('Headers applied');
}
function renderHdrCount() {
  var n = Object.keys(state.headers).length;
  var el = document.getElementById('hdrCount');
  el.hidden = n === 0;
  el.textContent = n;
}

