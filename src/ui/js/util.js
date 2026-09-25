/* ── Toasts & clipboard ── */
function showToast(msg, kind) {
  var wrap = document.getElementById('toastWrap');
  var el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(function() { el.remove(); }, 2600);
}
function copyText(text) {
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('Copied'); } catch(e) { showToast('Copy failed', 'err'); }
    ta.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function(){ showToast('Copied'); }, fallback);
  } else fallback();
}
function copyFromStore(key, which) {
  var d = state.drafts[key];
  if (!d) return;
  var obj = which === 'req' ? d.lastReq : d.lastRes;
  if (obj !== undefined) copyText(JSON.stringify(obj, null, 2));
}

/* ── HTTP helpers ── */
function statusClass(code) {
  if (!code) return 'snet';
  if (code >= 200 && code < 300) return 's2xx';
  if (code >= 400 && code < 500) return 's4xx';
  return 's5xx';
}
function getTimeout() {
  var v = parseInt(document.getElementById('timeoutInput').value, 10);
  return (isNaN(v) || v < 500) ? 15000 : v;
}
function getRetries() {
  return parseInt(document.getElementById('retriesSelect').value, 10) || 0;
}

