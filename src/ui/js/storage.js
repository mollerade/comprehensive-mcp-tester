/* ── Storage ── */
function loadServers() {
  try { state.servers = JSON.parse(localStorage.getItem('mcp_servers_v3') || '[]'); } catch(e) { state.servers = []; }
  renderServers();
}
function persistServers() {
  try { localStorage.setItem('mcp_servers_v3', JSON.stringify(state.servers)); } catch(e) {}
}
function persistCurrent() {
  try {
    localStorage.setItem('mcp_current_v1', JSON.stringify({
      url: document.getElementById('urlInput').value.trim(),
      timeout: document.getElementById('timeoutInput').value,
      headers: state.headers
    }));
  } catch(e) {}
  renderSaveBtn();
}
function restoreCurrent() {
  try {
    var c = JSON.parse(localStorage.getItem('mcp_current_v1') || 'null');
    if (!c) return;
    if (c.url) document.getElementById('urlInput').value = c.url;
    if (c.timeout) document.getElementById('timeoutInput').value = c.timeout;
    if (c.headers) state.headers = c.headers;
  } catch(e) {}
  renderHdrCount(); renderSaveBtn();
}
function findSavedIndex(url) {
  for (var i = 0; i < state.servers.length; i++) if (state.servers[i].url === url) return i;
  return -1;
}
function renderSaveBtn() {
  var url = document.getElementById('urlInput').value.trim();
  var idx = url ? findSavedIndex(url) : -1;
  var btn = document.getElementById('saveBtn');
  btn.classList.toggle('saved', idx !== -1);
  document.getElementById('saveBtnPath').setAttribute('fill', idx !== -1 ? 'currentColor' : 'none');
  btn.title = idx !== -1 ? 'Edit saved server' : 'Save this server';
}

