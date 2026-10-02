/**
 * Compliance collector — platform-free. Sends a fixed set of probes to one MCP
 * server and records every exchange, so the rule engine can grade the recording
 * without touching the network.
 *
 *   const ctx = await collectCompliance({ url, send, headers });
 *   const report = runCompliance(COMPLIANCE_CATALOGUE, ctx);
 *
 * `send(url, { method, headers, body })` resolves { status, headers, body } with
 * lower-case header names and the body as text, or { error } when the server
 * could not be reached. Hosts pass a function that goes through the proxy.
 * `headers` are extra request headers, such as Authorization; they are sent to
 * this url only, and never recorded.
 *
 * The probes stay MCP-shaped: discover (or initialize), the list methods and
 * their pages, one unknown method, one notification, and the era's own edge
 * cases (a bogus protocol version and a mismatched Mcp-Method header for the
 * stateless era; a missing and an unknown session id for the session era).
 * Nothing calls a tool, reads a resource or gets a prompt.
 */

export const COMPLIANCE_MODERN_VERSION = '2026-07-28';
export const COMPLIANCE_LEGACY_VERSION = '2025-11-25';
export const COMPLIANCE_META = 'io.modelcontextprotocol/';
const COMPLIANCE_CLIENT = { name: 'MCP Tester compliance check', version: '0.10.1' };
const COMPLIANCE_MAX_PAGES = 5;
const COMPLIANCE_BOGUS_VERSION = '1999-01-01';
const COMPLIANCE_UNKNOWN_METHOD = 'mcp-tester/no-such-method';

/** Event-stream text → the JSON payload of each data event */
export function parseEventStream(text) {
  const out = [];
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.indexOf('data:') === 0).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch { out.push({ unparsable: data }); }
  }
  return out;
}

/** The JSON-RPC messages in a response body: none, one, or an event stream's worth */
function bodyMessages(contentType, body) {
  if (!body) return [];
  if (contentType.indexOf('text/event-stream') !== -1) return parseEventStream(body);
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return [{ unparsable: body.slice(0, 200) }]; }
}

/** The response to this request among the messages: the last one with a result or an error */
function responseMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && typeof m === 'object' && ('result' in m || 'error' in m)) return m;
  }
  return null;
}

/** What came back, onto the exchange: the answer, or the transport error */
function recordAnswer(exchange, res) {
  if (!res || res.error || !res.status) {
    exchange.transportError = (res && res.error) || 'no response';
    return;
  }
  exchange.status = res.status;
  exchange.headers = res.headers || {};
  exchange.contentType = String(exchange.headers['content-type'] || '');
  exchange.raw = res.body || '';
  exchange.messages = bodyMessages(exchange.contentType, exchange.raw);
  exchange.response = responseMessage(exchange.messages);
}

/** Sends one probe and records it; `opts.omitSession` / `opts.session` override the session header */
function complianceRecorder(url, send, extraHeaders) {
  const rec = { exchanges: [], sessionId: null, era: null, version: null, nextId: 1 };

  rec.send = async function (label, body, headers) {
    const all = Object.assign({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, extraHeaders, headers);
    const exchange = { label, method: body.method, request: { headers: headers || {}, body } };
    let res;
    try { res = await send(url, { method: 'POST', headers: all, body: JSON.stringify(body) }); }
    catch (e) { res = { error: (e && e.message) || String(e) }; }
    recordAnswer(exchange, res);
    rec.exchanges.push(exchange);
    return exchange;
  };

  rec.request = function (method, params) {
    return { jsonrpc: '2.0', id: rec.nextId++, method, params: params || {} };
  };
  return rec;
}

// ── Stateless era (2026-07-28): version and identity in every request ──

function modernBody(rec, method, params, version, notification) {
  const body = notification ? { jsonrpc: '2.0', method, params: params || {} } : rec.request(method, params);
  body.params._meta = Object.assign({}, body.params._meta, {
    [COMPLIANCE_META + 'protocolVersion']: version,
    [COMPLIANCE_META + 'clientInfo']: COMPLIANCE_CLIENT,
    [COMPLIANCE_META + 'clientCapabilities']: {},
  });
  return body;
}

function modernHeadersFor(body, version) {
  return { 'mcp-protocol-version': version, 'mcp-method': body.method };
}

function sendModern(rec, label, method, params, opts) {
  opts = opts || {};
  const version = opts.version || rec.version;
  const body = modernBody(rec, method, params, version, opts.notification);
  const headers = Object.assign(modernHeadersFor(body, version), opts.headers);
  return rec.send(label, body, headers);
}

// ── Session era (2025-11-25 and earlier): initialize, then a session id ──

function legacyHeadersFor(rec, opts) {
  const h = {};
  const sid = opts.session !== undefined ? opts.session : rec.sessionId;
  if (sid && !opts.omitSession) h['mcp-session-id'] = sid;
  if (rec.version && rec.version >= '2025-06-18') h['mcp-protocol-version'] = rec.version;
  return h;
}

function sendLegacy(rec, label, method, params, opts) {
  opts = opts || {};
  const body = opts.notification ? { jsonrpc: '2.0', method, params: params || {} } : rec.request(method, params);
  return rec.send(label, body, legacyHeadersFor(rec, opts));
}

const ccResultOf = (exchange) => (exchange && exchange.response && exchange.response.result) || null;
const ccSucceeded = (exchange) => !!exchange && exchange.status >= 200 && exchange.status < 300 && !!ccResultOf(exchange);

/** tools/list (and the others), following nextCursor for a few pages */
async function collectPages(rec, sender, method) {
  let cursor;
  for (let page = 1; page <= COMPLIANCE_MAX_PAGES; page++) {
    const label = page === 1 ? method : method + ' page ' + page;
    const ex = await sender(rec, label, method, cursor === undefined ? {} : { cursor });
    const next = ccResultOf(ex) && ccResultOf(ex).nextCursor;
    if (typeof next !== 'string' || !next) return;
    cursor = next;
  }
}

async function collectLists(rec, sender, capabilities) {
  await collectPages(rec, sender, 'tools/list');
  if (capabilities.resources) await collectPages(rec, sender, 'resources/list');
  if (capabilities.prompts) await collectPages(rec, sender, 'prompts/list');
}

async function collectModern(rec, discover) {
  const result = ccResultOf(discover);
  const supported = Array.isArray(result.supportedVersions) ? result.supportedVersions : [];
  rec.version = supported.indexOf(COMPLIANCE_MODERN_VERSION) !== -1 || !supported.length ? COMPLIANCE_MODERN_VERSION : supported[0];
  const capabilities = result.capabilities || {};
  await collectLists(rec, sendModern, capabilities);
  await sendModern(rec, 'tools/list (repeat)', 'tools/list', {});
  await sendModern(rec, 'unknown method', COMPLIANCE_UNKNOWN_METHOD, {});
  await sendModern(rec, 'notification', 'notifications/cancelled', { requestId: 'mcp-tester-none', reason: 'compliance probe' }, { notification: true });
  await sendModern(rec, 'unsupported version', 'tools/list', {}, { version: COMPLIANCE_BOGUS_VERSION });
  await sendModern(rec, 'header mismatch', 'tools/list', {}, { headers: { 'mcp-method': 'prompts/list' } });
  return { era: 'modern', claimedVersion: rec.version, capabilities };
}

async function collectLegacy(rec) {
  const init = await rec.send('initialize', rec.request('initialize', {
    protocolVersion: COMPLIANCE_LEGACY_VERSION, capabilities: {}, clientInfo: COMPLIANCE_CLIENT,
  }), {});
  const result = ccResultOf(init);
  if (!ccSucceeded(init)) return { era: null, claimedVersion: null, capabilities: {} };
  rec.sessionId = init.headers['mcp-session-id'] || null;
  rec.version = typeof result.protocolVersion === 'string' ? result.protocolVersion : null;
  const capabilities = result.capabilities || {};
  await sendLegacy(rec, 'notification', 'notifications/initialized', {}, { notification: true });
  await collectLists(rec, sendLegacy, capabilities);
  await sendLegacy(rec, 'unknown method', COMPLIANCE_UNKNOWN_METHOD, {});
  if (rec.sessionId) {
    await sendLegacy(rec, 'no session', 'tools/list', {}, { omitSession: true });
    await sendLegacy(rec, 'unknown session', 'tools/list', {}, { session: 'mcp-tester-unknown-session' });
  }
  return { era: 'legacy', claimedVersion: rec.version, capabilities };
}

/** 'server/discover: HTTP 401 ...; initialize: HTTP 401 ...', for a server that completed no handshake */
function handshakeFailure(exchanges) {
  return exchanges.map((e) => {
    const err = e.response && e.response.error;
    const why = e.transportError || ('HTTP ' + e.status + (err && err.message ? ' ' + err.message : e.raw ? ' ' + e.raw.slice(0, 120) : ''));
    return e.method + ': ' + why;
  }).join('; ');
}

/**
 * Probe the server and return the engine's ctx:
 * { url, era, claimedVersion, capabilities, probed: true, exchanges, handshakeError? }.
 * era is null, and handshakeError says why, when neither handshake succeeded:
 * the server needs a sign-in (401/403), is not an MCP server, or cannot be reached.
 * The stateless era is tried first (server/discover); any HTTP error falls back
 * to initialize, as the client does. A server that cannot be reached at all
 * gives a recording with no answers, which the rules grade as skipped.
 */
export async function collectCompliance(opts) {
  const rec = complianceRecorder(opts.url, opts.send, opts.headers || {});
  rec.version = COMPLIANCE_MODERN_VERSION;
  const discover = await sendModern(rec, 'discover', 'server/discover', {});
  let found;
  if (ccSucceeded(discover)) {
    rec.era = 'modern';
    found = await collectModern(rec, discover);
  } else if (discover.transportError) {
    found = { era: null, claimedVersion: null, capabilities: {} };
  } else {
    rec.era = 'legacy';
    rec.version = null;
    found = await collectLegacy(rec);
  }
  const ctx = { url: opts.url, era: found.era, claimedVersion: found.claimedVersion, capabilities: found.capabilities, probed: true, exchanges: rec.exchanges };
  if (!found.era) ctx.handshakeError = handshakeFailure(rec.exchanges);
  return ctx;
}
