/* ── Init ── */
loadServers();
restoreCurrent();
renderThemeBtn();
document.getElementById('urlInput').addEventListener('input', renderSaveBtn);
if (state.servers.length) document.getElementById('sidebar').classList.remove('collapsed');
