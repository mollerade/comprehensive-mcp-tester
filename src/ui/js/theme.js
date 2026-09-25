/* ── Theme ── */
var THEMES = ['system', 'light', 'dark'];
function currentTheme() {
  try { var t = localStorage.getItem('mcp_theme'); return (t === 'light' || t === 'dark') ? t : 'system'; }
  catch(e) { return 'system'; }
}
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  try { if (t === 'system') localStorage.removeItem('mcp_theme'); else localStorage.setItem('mcp_theme', t); } catch(e) {}
  renderThemeBtn();
  if (state.activeTab === 'diag') renderTab();
}
function cycleTheme() {
  var i = THEMES.indexOf(currentTheme());
  applyTheme(THEMES[(i + 1) % THEMES.length]);
}
function renderThemeBtn() {
  var t = currentTheme(), btn = document.getElementById('themeBtn');
  var icons = {
    system: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M5.5 14h5M8 11.5V14"/></svg>',
    light:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.8M8 13.2V15M15 8h-1.8M2.8 8H1M12.95 3.05l-1.27 1.27M4.32 11.68l-1.27 1.27M12.95 12.95l-1.27-1.27M4.32 4.32L3.05 3.05"/></svg>',
    dark:   '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 9.5A6 6 0 1 1 6.5 2.5a4.8 4.8 0 0 0 7 7z"/></svg>'
  };
  btn.innerHTML = icons[t];
  btn.title = 'Theme: ' + t + ' (tap to change)';
}

