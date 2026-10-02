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
      retries: getRetries(),
      purpose: options.purpose
    })
  }).then(function(res) {
    return res.json().then(function(env) {
      if (env.error && env.status === undefined) env = proxyRefusalEnvelope(env);
      var clientMs = Date.now() - clientStart;
      var d = env.diag || {};
      return {
        ok: env.status >= 200 && env.status < 300,
        status: env.status,
        headers: env.headers || {},
        bodyText: env.body,
        proxyError: env.error || null,
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

/* The proxy itself refused (a target outside its policy, a refused redirect, bad input):
   no origin was reached, so there is no status. Shown as a failed call with the proxy's
   reason and hint, never as a success or an auth challenge. */
function proxyRefusalEnvelope(env) {
  var reason = env.error + (env.hint ? ' ' + env.hint : '');
  var detail = 'Proxy: ' + reason;
  return {
    status: null, headers: {}, error: reason,
    body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: detail }, id: null }),
    diag: { ok: false, errorType: 'proxy', errorDetail: detail, redirects: env.redirects || [] }
  };
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

/* ── Modern-era request metadata ──
   Every modern request carries version, identity and capabilities in params._meta,
   and Streamable HTTP mirrors them into headers so intermediaries can route. */
function speaksModern(body) {
  return body.method === 'server/discover' || (state.era === 'modern' && body.method !== 'initialize');
}

function applyModernMeta(body) {
  if (!speaksModern(body) || body.id === undefined) return;
  if (!body.params || typeof body.params !== 'object') body.params = {};
  var meta = body.params._meta || {};
  if (!meta[MCP_META + 'protocolVersion']) meta[MCP_META + 'protocolVersion'] = (state.era === 'modern' && state.protocolVersion) || MODERN_VERSIONS[0];
  if (!meta[MCP_META + 'clientInfo']) meta[MCP_META + 'clientInfo'] = CLIENT_INFO;
  if (!meta[MCP_META + 'clientCapabilities']) meta[MCP_META + 'clientCapabilities'] = {};
  body.params._meta = meta;
}

function modernHeaders(body) {
  var h = {}, p = body.params || {};
  var v = (p._meta || {})[MCP_META + 'protocolVersion'];
  if (v) h['MCP-Protocol-Version'] = String(v);
  h['Mcp-Method'] = String(body.method);
  var name = body.method === 'resources/read' ? p.uri
           : (body.method === 'tools/call' || body.method === 'prompts/get') ? p.name : null;
  if (name != null) h['Mcp-Name'] = encodeHeaderValue(String(name));
  if (body.method === 'tools/call') {
    var tool = null;
    for (var i = 0; i < state.tools.length; i++) { if (state.tools[i].name === p.name) tool = state.tools[i]; }
    if (tool) collectParamHeaders(tool.inputSchema, p.arguments, h);
  }
  return h;
}

/* x-mcp-header: mirror annotated primitive arguments into Mcp-Param-{Name}.
   Only plain `properties` chains count; invalid names are skipped here and
   left for the compliance check to report. */
function collectParamHeaders(schema, value, out) {
  var props = schema && schema.properties;
  if (!props || !value || typeof value !== 'object') return;
  for (var k in props) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    var ps = props[k] || {}, v = value[k], hn = ps['x-mcp-header'];
    var primitive = typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && v % 1 === 0);
    if (hn && primitive && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(hn)) out['Mcp-Param-' + hn] = encodeHeaderValue(String(v));
    collectParamHeaders(ps, v, out);
  }
}

/* Header-safe values pass through; anything else uses the =?base64?…?= sentinel */
function encodeHeaderValue(s) {
  var sentinel = s.indexOf('=?base64?') === 0 && s.slice(-2) === '?=';
  if (/^[\x20-\x7E\t]*$/.test(s) && s === s.replace(/^[ \t]+|[ \t]+$/g, '') && !sentinel) return s;
  return '=?base64?' + btoa(unescape(encodeURIComponent(s))) + '?=';
}

function isModernError(data) {
  return !!(data && data.error && MODERN_ERROR_CODES.indexOf(data.error.code) !== -1);
}

/* A connection generation: bumped by every connect and disconnect. A response is
   stale when the generation moved on while it was in flight; it is logged (it did
   happen on the wire) but never touches session, auth, diagnostics or view state. */
function isStale(gen) {
  return gen !== state.generation;
}

function staleResult() {
  return { data: { error: { message: 'stale response from a previous connection' } }, status: null,
           diag: null, clientMs: null, isErr: true, transportOk: false, stale: true };
}

function copyHeaders(into, from) {
  for (var k in from) { if (Object.prototype.hasOwnProperty.call(from, k)) into[k] = from[k]; }
  return into;
}

function legacyHeaders() {
  var h = {};
  if (state.sessionId) h['mcp-session-id'] = state.sessionId;
  // Required from 2025-06-18 on; ISO dates compare as strings
  if (state.connected && state.protocolVersion && state.protocolVersion >= '2025-06-18') h['MCP-Protocol-Version'] = state.protocolVersion;
  return h;
}

function requestHeaders(body) {
  var hdrs = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  copyHeaders(hdrs, state.headers);
  copyHeaders(hdrs, authHeaders());
  return copyHeaders(hdrs, body.method && speaksModern(body) ? modernHeaders(body) : legacyHeaders());
}

function parseResponseBody(res) {
  var ct = (res.get('content-type') || '');
  if (ct.indexOf('text/event-stream') !== -1) {
    var messages = parseSSE(res.bodyText);
    return { data: messages.length ? messages[messages.length - 1] : {}, sseCount: messages.length };
  }
  try { return { data: JSON.parse(res.bodyText), sseCount: null }; }
  catch(e) { return { data: { raw: res.bodyText }, sseCount: null }; }
}

function responseIsError(transportOk, data, status) {
  return !transportOk || !!(data && data.error) || status >= 400;
}

/* An HTTP error to the era-detection request is the expected legacy signal, not an outage */
function isExpectedLegacySignal(source, isErr, transportOk, data) {
  return source === 'detect' && isErr && transportOk && !isModernError(data);
}

function handleResponse(res, method, source, gen) {
  var parsed = parseResponseBody(res), data = parsed.data, status = res.status;
  var d = res.diag || {};
  var transportOk = d.ok !== false;
  var isErr = responseIsError(transportOk, data, status);

  addLog(isErr ? 'err' : (parsed.sseCount != null ? 'sse' : 'res'), method,
         { body: data, sseEvents: parsed.sseCount }, status, res.headers, res);
  if (isStale(gen)) return staleResult();

  noteSessionAndAuth(res);
  if (!isExpectedLegacySignal(source, isErr, transportOk, data)) recordProbe(probeOf(res, data, isErr, method, source));
  return { data: data, status: status, diag: d, clientMs: res.clientMs, isErr: isErr, transportOk: transportOk };
}

function noteSessionAndAuth(res) {
  var sid = res.get('mcp-session-id');
  if (sid) state.sessionId = sid;
  if (res.status === 401 || res.status === 403) noteAuthChallenge(res.status, res.get('www-authenticate'));
}

function probeOf(res, data, isErr, method, source) {
  var d = res.diag || {}, status = res.status;
  return {
    t: Date.now(), ok: !isErr, status: status,
    ms: d.totalMs != null ? d.totalMs : res.clientMs,
    ttfb: d.ttfbMs != null ? d.ttfbMs : null,
    clientMs: res.clientMs, overhead: res.overheadMs,
    errorType: isErr ? classifyError(d, status, data) : null,
    errorDetail: errorDetailOf(d, status, data),
    attempts: d.attempts || 1, colo: d.colo || null,
    method: method, source: source || 'call'
  };
}

function handleSendFailure(e, method, source, gen) {
  addLog('err', method, { body: { error: e.message } }, null, null, null);
  if (isStale(gen)) return staleResult();
  recordProbe({
    t: Date.now(), ok: false, status: null, ms: null, ttfb: null,
    clientMs: null, overhead: null,
    errorType: 'client', errorDetail: e.message, attempts: 1,
    colo: null, method: method, source: source || 'call'
  });
  return { data: { error: { message: e.message } }, status: null, diag: null, clientMs: null, isErr: true, transportOk: false };
}

/* Headers are built at send time, so a renewed token is picked up */
function postToServer(body) {
  return proxyFetch(state.serverUrl, { method: 'POST', headers: requestHeaders(body), body: JSON.stringify(body) });
}

function sendBody(body, source) {
  var method = body.method || 'raw';
  var gen = state.generation;
  applyModernMeta(body);
  addLog('req', method, { body: body }, null, null, null);
  return ensureFreshToken()
    .then(function() { return postToServer(body); })
    .then(function(res) { return retryAfterRenewal(res, body, method, gen); })
    .then(function(res) { return handleResponse(res, method, source, gen); })
    .catch(function(e) { return handleSendFailure(e, method, source, gen); });
}

function rpc(method, params, source) {
  return sendBody(buildBody(method, params), source).then(function(r) {
    if (r.stale) return { error: r.data.error, stale: true };
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

/* ── Connect ──
   Dual-era client per spec 2026-07-28: try a modern server/discover first. A recognised
   modern error means the server is modern (retry with a version it lists); any other
   HTTP error means legacy, so fall back to the initialize handshake. A transport
   failure is just a failure: falling back would only double the wait. */
function handleConnect() {
  if (state.connecting) return;
  if (state.connected) { disconnect(); return; }
  var url = document.getElementById('urlInput').value.trim();
  if (!url) { showToast('Enter a server URL first', 'err'); return; }
  state.serverUrl = url;
  state.transport = 'streamable';
  state.connecting = true;
  state.era = null; state.protocolVersion = null; state.sessionId = null;
  var gen = ++state.generation;
  var startedAt = Date.now();
  persistCurrent();
  setStatus('connecting', 'Connecting...');
  document.getElementById('connectBtn').textContent = '...';
  document.getElementById('connectBtn').className = 'btn btn-primary';

  negotiate().then(function(res) {
    if (isStale(gen)) return;
    if (res.error) return connectFailed(res.error, startedAt);
    showConnected(res.info);
    if (state.era === 'legacy') return rpc('notifications/initialized', {}).then(function() { return fetchAll(gen); });
    return fetchAll(gen);
  });
}

function connectFailed(error, startedAt) {
  state.connecting = false;
  state.era = null; state.protocolVersion = null;
  document.getElementById('connectBtn').textContent = 'Connect';
  document.getElementById('connectBtn').className = 'btn btn-primary';
  if (auth.challenge && auth.challenge.at >= startedAt) {
    setStatus('error', auth.challenge.status === 403 ? 'Access denied' : 'Sign-in required');
    showToast('The server wants credentials (HTTP ' + auth.challenge.status + ')', 'err');
    openAuthModal(true);
    return;
  }
  setStatus('error', 'Failed');
  showToast('Connection failed: ' + (error.message || 'see Log tab'), 'err');
}

function showConnected(info) {
  state.serverInfo = info;
  state.connected = true;
  state.connecting = false;
  var si = (state.serverInfo.serverInfo || {});
  var label = 'Connected';
  if (si.name) label += ' \u00b7 ' + si.name + (si.version ? ' ' + si.version : '');
  setStatus('connected', label);
  document.getElementById('statusPill').title = 'Streamable HTTP' +
    (state.protocolVersion ? ' \u00b7 protocol ' + state.protocolVersion : '') +
    (state.era === 'modern' ? ' \u00b7 stateless' : ' \u00b7 legacy (initialize handshake)');
  document.getElementById('connectBtn').textContent = 'Disconnect';
  document.getElementById('connectBtn').className = 'btn btn-disconnect';
}

function negotiate() {
  return discoverAs(MODERN_VERSIONS[0]).then(function(r) {
    if (r.info || r.stale) return r;
    if (!r.transportOk || r.status === 401 || r.status === 403) return { error: r.error };
    if (isModernError(r.data)) return retryModernError(r.data.error);
    return legacyConnect(LEGACY_VERSION);
  });
}

/* A modern server refused our version: retry with one it lists, modern first */
function retryModernError(err) {
  var supported = (err.code === -32022 && err.data && err.data.supported) || [];
  var modern = pickVersion(supported, MODERN_VERSIONS);
  if (modern) return discoverAs(modern).then(function(r2) { return r2.info ? r2 : { error: r2.error }; });
  var legacy = pickVersion(supported, null);
  if (legacy) return legacyConnect(legacy);
  return { error: err };
}

/* First entry of `supported` that we speak: one of `ours`, or (ours = null) any legacy date */
function pickVersion(supported, ours) {
  for (var i = 0; i < supported.length; i++) {
    var v = supported[i];
    if (ours ? ours.indexOf(v) !== -1 : (v <= LEGACY_VERSION && MODERN_VERSIONS.indexOf(v) === -1)) return v;
  }
  return null;
}

function discoverAs(version) {
  state.era = 'modern'; state.protocolVersion = version;
  return sendBody(buildBody('server/discover', {}), 'detect').then(function(r) {
    if (r.stale) return { error: r.data.error, stale: true };
    var result = r.data && r.data.result;
    if (!r.isErr && result) return { info: discoverInfo(result, version) };
    state.era = null; state.protocolVersion = null;
    return { transportOk: r.transportOk, status: r.status, data: r.data || {},
             error: (r.data && r.data.error) || { message: (r.diag && r.diag.errorDetail) || ('HTTP ' + r.status) } };
  });
}

function discoverInfo(result, version) {
  var meta = result._meta || {};
  return {
    serverInfo: meta[MCP_META + 'serverInfo'] || {},
    protocolVersion: version,
    supportedVersions: result.supportedVersions || [],
    capabilities: result.capabilities || {},
    instructions: result.instructions || null
  };
}

function legacyConnect(version) {
  state.era = 'legacy';
  return rpc('initialize', {
    protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO
  }).then(function(res) {
    if (res.error) return res;
    var info = res.result || {};
    state.protocolVersion = info.protocolVersion || version;
    return { info: info };
  });
}

function disconnect() {
  state.generation++;
  state.connected = false; state.sessionId = null;
  state.era = null; state.protocolVersion = null;
  state.tools = []; state.resources = []; state.prompts = [];
  state.serverInfo = null; state.drafts = {};
  setStatus('disconnected', 'Disconnected');
  document.getElementById('statusPill').title = '';
  document.getElementById('connectBtn').textContent = 'Connect';
  document.getElementById('connectBtn').className = 'btn btn-primary';
  renderTab(); updateBadges();
}

function fetchAll(gen) {
  function list(method, key) {
    return rpc(method).then(function(r) {
      if (!isStale(gen) && r.result) state[key] = r.result[key] || [];
    });
  }
  var p = [list('tools/list', 'tools'), list('resources/list', 'resources'), list('prompts/list', 'prompts')];
  return Promise.all(p.map(function(x) { return x.catch(function(){}); })).then(function() {
    if (isStale(gen)) return;
    updateBadges(); renderTab();
  });
}
