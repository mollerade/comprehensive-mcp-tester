/* ── Init ── */
document.getElementById('appVersion').textContent = 'v' + CLIENT_INFO.version;
if (location.pathname === '/oauth/callback' && !isRedirectCallback()) {
  finishOAuthPopup();
} else {
  loadServers();
  restoreCurrent();
  renderThemeBtn();
  renderAuthBadge();
  document.getElementById('urlInput').addEventListener('input', renderSaveBtn);
  window.addEventListener('message', onAuthMessage);
  if (state.servers.length) document.getElementById('sidebar').classList.remove('collapsed');
  if (location.pathname === '/oauth/callback') resumeRedirectSignIn();
}
