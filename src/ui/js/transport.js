/* ── Server-side proxy fetch ── */
function proxyFetch(targetUrl, options) {
  var clientStart = Date.now();
  return fetch('/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: targetUrl,
      method: options.method || 'POST',
      headers: options.headers || {},
      body: options.body || null,
      timeoutMs: getTimeout(),
      retries: getRetries()
    })
  }).then(function(res) {
    return res.json().then(function(env) {
      var clientMs = Date.now() - clientStart;
      var d = env.diag || {};
      return {
        ok: env.status >= 200 && env.status < 300,
        status: env.status,
        headers: env.headers || {},
        bodyText: env.body,
        diag: d,
        clientMs: clientMs,
        overheadMs: Math.max(0, clientMs - (d.totalMs || 0)),
        get: function(h) {
          if (!env.headers) return null;
          return env.headers[h] || env.headers[h.toLowerCase()] || null;
        }
      };
    });
  });
}

/* ── Core sender ──
   Sends any JSON-RPC body through the proxy; records log + probe; returns
   the full envelope so callers can show raw request/response. */
function buildBody(method, params) {
  var isNotification = method.indexOf('notifications/') === 0;
  var body = { jsonrpc: '2.0', method: method, params: params || {} };
  if (!isNotification) body.id = ++state.rpcId;
  return body;
}

function sendBody(body, source) {
  var method = body.method || 'raw';
  addLog('req', method, { body: body }, null, null, null);

  var hdrs = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  for (var k in state.headers) { if (state.headers.hasOwnProperty(k)) hdrs[k] = state.headers[k]; }
  if (state.sessionId) hdrs['mcp-session-id'] = state.sessionId;

  return proxyFetch(state.serverUrl, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
    .then(function(res) {
      var sid = res.get('mcp-session-id');
      if (sid) state.sessionId = sid;

      var status = res.status;
      var text = res.bodyText;
      var ct = (res.get('content-type') || '');
      var data, sseCount = null;

      if (ct.indexOf('text/event-stream') !== -1) {
        var messages = parseSSE(text);
        sseCount = messages.length;
        data = messages.length ? messages[messages.length - 1] : {};
      } else {
        try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }
      }

      var d = res.diag || {};
      var transportOk = d.ok !== false;
      var isErr = !transportOk || !!(data && data.error) || status >= 400;

      recordProbe({
        t: Date.now(), ok: !isErr, status: status,
        ms: d.totalMs != null ? d.totalMs : res.clientMs,
        ttfb: d.ttfbMs != null ? d.ttfbMs : null,
        clientMs: res.clientMs, overhead: res.overheadMs,
        errorType: isErr ? classifyError(d, status, data) : null,
        errorDetail: errorDetailOf(d, status, data),
        attempts: d.attempts || 1, colo: d.colo || null,
        method: method, source: source || 'call'
      });

      addLog(isErr ? 'err' : (sseCount != null ? 'sse' : 'res'), method,
             { body: data, sseEvents: sseCount }, status, res.headers, res);

      return { data: data, status: status, diag: d, clientMs: res.clientMs, isErr: isErr, transportOk: transportOk };
    })
    .catch(function(e) {
      recordProbe({
        t: Date.now(), ok: false, status: null, ms: null, ttfb: null,
        clientMs: null, overhead: null,
        errorType: 'client', errorDetail: e.message, attempts: 1,
        colo: null, method: method, source: source || 'call'
      });
      addLog('err', method, { body: { error: e.message } }, null, null, null);
      return { data: { error: { message: e.message } }, status: null, diag: null, clientMs: null, isErr: true, transportOk: false };
    });
}

function rpc(method, params, source) {
  return sendBody(buildBody(method, params), source).then(function(r) {
    if (r.data && r.data.error) return { error: r.data.error };
    if (!r.transportOk) return { error: { message: (r.diag && r.diag.errorDetail) || 'transport failure' } };
    return r.data;
  });
}

function classifyError(d, status, data) {
  if (d && d.errorType) return d.errorType;
  if (status >= 500) return 'http5xx';
  if (status >= 400) return 'http4xx';
  if (data && data.error) return 'jsonrpc';
  return 'unknown';
}
function errorDetailOf(d, status, data) {
  if (d && d.errorDetail) return d.errorDetail;
  if (data && data.error) return (data.error.message || JSON.stringify(data.error));
  if (status >= 400) return 'HTTP ' + status;
  return null;
}

function parseSSE(text) {
  var events = [], current = '';
  var lines = (text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf('data: ') === 0) {
      current += line.substring(6);
    } else if (line === '' && current) {
      try { events.push(JSON.parse(current)); } catch(e) { events.push({ raw: current }); }
      current = '';
    }
  }
  if (current) {
    try { events.push(JSON.parse(current)); } catch(e) { events.push({ raw: current }); }
  }
  return events;
}

/* ── Connect ── */
function handleConnect() {
  if (state.connecting) return;
  if (state.connected) { disconnect(); return; }
  var url = document.getElementById('urlInput').value.trim();
  if (!url) { showToast('Enter a server URL first', 'err'); return; }
  state.serverUrl = url;
  state.transport = 'streamable';
  state.connecting = true;
  persistCurrent();
  setStatus('connecting', 'Connecting...');
  document.getElementById('connectBtn').textContent = '...';
  document.getElementById('connectBtn').className = 'btn btn-primary';

  rpc('initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'MCP Tester', version: '5.0.0' }
  }).then(function(res) {
    if (res.error) {
      state.connecting = false;
      setStatus('error', 'Failed');
      document.getElementById('connectBtn').textContent = 'Connect';
      document.getElementById('connectBtn').className = 'btn btn-primary';
      showToast('Connection failed: ' + (res.error.message || 'see Log tab'), 'err');
      return;
    }
    state.serverInfo = res.result || {};
    state.connected = true;
    state.connecting = false;
    var si = (state.serverInfo.serverInfo || {});
    var label = 'Connected';
    if (si.name) label += ' \u00b7 ' + si.name + (si.version ? ' ' + si.version : '');
    setStatus('connected', label);
    document.getElementById('statusPill').title = 'Streamable HTTP' +
      (state.serverInfo.protocolVersion ? ' \u00b7 protocol ' + state.serverInfo.protocolVersion : '');
    document.getElementById('connectBtn').textContent = 'Disconnect';
    document.getElementById('connectBtn').className = 'btn btn-disconnect';
    return rpc('notifications/initialized', {}).then(function() { return fetchAll(); });
  });
}

function disconnect() {
  state.connected = false; state.sessionId = null;
  state.tools = []; state.resources = []; state.prompts = [];
  state.serverInfo = null; state.drafts = {};
  setStatus('disconnected', 'Disconnected');
  document.getElementById('statusPill').title = '';
  document.getElementById('connectBtn').textContent = 'Connect';
  document.getElementById('connectBtn').className = 'btn btn-primary';
  renderTab(); updateBadges();
}

function fetchAll() {
  var p = [];
  p.push(rpc('tools/list').then(function(r) { if (r.result) state.tools = r.result.tools || []; }));
  p.push(rpc('resources/list').then(function(r) { if (r.result) state.resources = r.result.resources || []; }));
  p.push(rpc('prompts/list').then(function(r) { if (r.result) state.prompts = r.result.prompts || []; }));
  return Promise.all(p.map(function(x) { return x.catch(function(){}); })).then(function() { updateBadges(); renderTab(); });
}

