/**
 * MCP proxy core — platform-agnostic.
 *
 * Forwards one MCP JSON-RPC request to a target server and returns an
 * envelope carrying the origin's status, headers and body plus timing
 * diagnostics. It has no knowledge of Cloudflare, Node or any host: hosts
 * parse the incoming request, call proxyMcp(), and serialise the result.
 *
 * Contract (relied on by the UI):
 *   input  { url, method?, headers?, body?, timeoutMs?, retries?, purpose? }
 *          purpose: 'mcp' (default) or 'oauth'. OAuth discovery and token calls
 *          aren't MCP requests, so the MCP Accept/Content-Type repairs are skipped.
 *   output { status, json }  where json is either
 *          { error }                                  (bad input, 4xx)
 *          { status, headers, body, diag }             (origin reached or failed)
 *
 * A failed transport (timeout / network) is reported with HTTP 200 and
 * envelope status 0, so the UI can always read the diagnostics.
 *
 * Every URL fetched — the target and each redirect hop — goes through the
 * target policy (target-policy.js). A refused URL is answered 403
 * { error, hint? } and never fetched. Redirects are followed here, not by
 * fetch, so each hop is checked; a hop to another origin carries only the
 * protocol headers, never credentials, cookies or the session.
 */
import { checkTarget, parseTargetList, REFUSED_CODE } from './target-policy.js';

export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_TIMEOUT_MS = 120000;
export const MAX_RETRIES = 3;

export const MAX_REDIRECTS = 5;

// Hop-by-hop and identity headers never forwarded to the origin
export const SKIP_HEADERS = ['host', 'origin', 'referer', 'connection', 'upgrade', 'transfer-encoding', 'content-length'];

// What a redirect to another origin may still carry: protocol, not identity
var CROSS_ORIGIN_HEADERS = ['accept', 'content-type', 'mcp-protocol-version', 'mcp-method', 'mcp-name', 'last-event-id', 'user-agent'];
function protocolHeader(name) {
  name = name.toLowerCase();
  return CROSS_ORIGIN_HEADERS.indexOf(name) !== -1 || name.indexOf('mcp-param-') === 0;
}

export function clampInt(v, lo, hi, dflt) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** "a.com, b.com" → ["a.com","b.com"]; empty/undefined → [] */
export function parseAllowedOrigins(str) {
  return parseTargetList(str);
}

function refused(check, extra) {
  var json = { error: check.error };
  if (check.hint) json.hint = check.hint;
  if (check.allowed) json.allowed = check.allowed;
  return { status: 403, json: Object.assign(json, extra || {}) };
}

function isRedirect(resp) {
  return resp.status >= 300 && resp.status <= 399 && resp.status !== 304 && !!resp.headers.get('location');
}

/** Where a redirect leads: { next } or { refusal }; records the hop in redirects */
function redirectTarget(resp, url, redirects, policy) {
  var location = resp.headers.get('location');
  var next;
  try { next = new URL(location, url); } catch { next = null; }
  redirects.push({ status: resp.status, location: next ? next.href : location });
  if (!next) return { refusal: { status: 502, json: { error: 'Redirect to an invalid URL: ' + location, redirects: redirects } } };
  if (redirects.length > MAX_REDIRECTS) {
    return { refusal: { status: 502, json: { error: 'Too many redirects (more than ' + MAX_REDIRECTS + ')', redirects: redirects } } };
  }
  var check = checkTarget(next, policy);
  if (check) {
    return { refusal: refused({ error: 'Redirect refused: ' + check.error, hint: check.hint, allowed: check.allowed }, { redirects: redirects }) };
  }
  return { next: next };
}

/** The request to send to the next hop: req is { method, body, headers } and is updated in place */
function followRedirect(req, status, sameOrigin) {
  // 303, and 301/302 after a POST, continue as a GET without a body (as browsers do)
  if (status === 303 || ((status === 301 || status === 302) && req.method === 'POST')) {
    if (req.method !== 'HEAD') req.method = 'GET';
    req.body = null;
    req.headers.delete('content-type');
  }
  if (!sameOrigin) {
    var kept = new Headers();
    req.headers.forEach(function (v, k) { if (protocolHeader(k)) kept.set(k, v); });
    req.headers = kept;
  }
}

/**
 * fetch with redirects followed by hand, each hop checked against the policy.
 * Resolves { resp, redirects } or { refusal } (a result to return as is).
 */
async function fetchChecked(doFetch, url, init, policy) {
  var redirects = [];
  var req = { method: init.method, body: init.body, headers: new Headers(init.headers) };
  for (;;) {
    var resp = await doFetch(url.href, {
      method: req.method, headers: req.headers, body: req.body, redirect: 'manual', signal: init.signal,
    });
    if (!isRedirect(resp)) return { resp: resp, redirects: redirects };
    try { if (resp.body && resp.body.cancel) await resp.body.cancel(); } catch { /* already consumed */ }
    var hop = redirectTarget(resp, url, redirects, policy);
    if (hop.refusal) return hop;
    followRedirect(req, resp.status, hop.next.origin === url.origin);
    url = hop.next;
  }
}

/** Headers for the origin: the caller's minus hop-by-hop ones, with MCP's Accept and Content-Type repaired */
function originHeaders(headers, purpose, method) {
  var out = new Headers();
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (SKIP_HEADERS.indexOf(keys[i].toLowerCase()) === -1) out.set(keys[i], headers[keys[i]]);
  }
  if (purpose === 'oauth') {
    if (!out.get('accept')) out.set('accept', 'application/json');
  } else {
    repairMcpHeaders(out, method);
  }
  return out;
}

// MCP Streamable HTTP requires the client to accept BOTH content types.
// Enforced here so it can never be missing or partial.
function repairMcpHeaders(out, method) {
  var accept = out.get('accept') || '';
  if (accept.indexOf('application/json') === -1 || accept.indexOf('text/event-stream') === -1) {
    out.set('accept', 'application/json, text/event-stream');
  }
  if (!out.get('content-type') && method !== 'GET' && method !== 'HEAD') out.set('content-type', 'application/json');
}

/**
 * @param {object} payload  parsed proxy request from the UI
 * @param {object} env
 * @param {Function} env.fetch          fetch implementation (global fetch in every host)
 * @param {string[]} [env.allowTargets] the operator's target list (see target-policy.js); env.allowedOrigins is the old name
 * @param {boolean} [env.allowAnyPublic] what an empty list means: any public target (default) or none (the Worker)
 * @param {string|null} [env.colo]      where this proxy instance runs (diagnostics only)
 */
export async function proxyMcp(payload, env) {
  env = env || {};
  var doFetch = env.fetch || fetch;
  var policy = { allow: env.allowTargets || env.allowedOrigins || [], allowAnyPublic: env.allowAnyPublic !== false };
  var colo = env.colo || null;

  payload = payload || {};
  var targetUrl = payload.url;
  var method = String(payload.method || 'POST').toUpperCase();
  var headers = payload.headers || {};
  var body = payload.body || null;
  var timeoutMs = clampInt(payload.timeoutMs, 500, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  var retries = clampInt(payload.retries, 0, MAX_RETRIES, 0);
  var purpose = payload.purpose === 'oauth' ? 'oauth' : 'mcp';

  if (!targetUrl) return { status: 400, json: { error: "Missing 'url' in request" } };

  var parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { status: 400, json: { error: 'Invalid target URL' } };
  }

  var check = checkTarget(parsed, policy);
  if (check) return refused(check);

  var outHeaders = originHeaders(headers, purpose, method);

  var attemptLog = [];
  var lastErr = null;

  for (var attempt = 1; attempt <= retries + 1; attempt++) {
    // On Workers the clock advances on I/O, so spans around an awaited fetch are real.
    var t0 = Date.now();
    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);

    try {
      var fetched = await fetchChecked(doFetch, parsed, {
        method: method,
        headers: outHeaders,
        body: (method === 'GET' || method === 'HEAD') ? null : body,
        signal: controller.signal,
      }, policy);
      if (fetched.refusal) {
        clearTimeout(timer);
        return fetched.refusal;      // a policy answer, not a transport failure: never retried
      }
      var resp = fetched.resp;

      // fetch resolves once response headers arrive — time to first byte
      var tHeaders = Date.now();
      var respBody = await resp.text();
      var tEnd = Date.now();
      clearTimeout(timer);

      var respHeaders = {};
      resp.headers.forEach(function (val, key) { respHeaders[key] = val; });

      attemptLog.push({ n: attempt, outcome: 'response', status: resp.status, ms: tEnd - t0 });

      return {
        status: 200,
        json: {
          status: resp.status,
          headers: respHeaders,
          body: respBody,
          diag: {
            ok: true,
            errorType: null,
            errorDetail: null,
            ttfbMs: tHeaders - t0,
            bodyMs: tEnd - tHeaders,
            totalMs: tEnd - t0,
            attempts: attempt,
            attemptLog: attemptLog,
            colo: colo,
            targetHost: parsed.hostname,
            timeoutMs: timeoutMs,
            redirects: fetched.redirects,
          },
        },
      };
    } catch (err) {
      clearTimeout(timer);
      // The host refused to connect (a name that resolves to a special-purpose address): a policy answer
      if (err && err.code === REFUSED_CODE) return refused({ error: err.message, hint: err.hint });
      var ms = Date.now() - t0;
      var isTimeout = timedOut || (err && err.name === 'AbortError');
      lastErr = {
        errorType: isTimeout ? 'timeout' : 'network',
        errorDetail: isTimeout
          ? ('No response within ' + timeoutMs + 'ms')
          : ((err && err.message) ? err.message : 'Network failure reaching origin'),
        ms: ms,
      };
      attemptLog.push({ n: attempt, outcome: lastErr.errorType, status: null, ms: ms });

      if (attempt <= retries) {
        await new Promise(function (r) { setTimeout(r, Math.min(2000, 250 * Math.pow(2, attempt - 1))); });
      }
    }
  }

  // All attempts failed — a transport failure, not an HTTP status
  return {
    status: 200,
    json: {
      status: 0,
      headers: {},
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: lastErr ? lastErr.errorDetail : 'Request failed' },
        id: null,
      }),
      diag: {
        ok: false,
        errorType: lastErr ? lastErr.errorType : 'network',
        errorDetail: lastErr ? lastErr.errorDetail : 'Request failed',
        ttfbMs: null,
        bodyMs: null,
        totalMs: lastErr ? lastErr.ms : null,
        attempts: retries + 1,
        attemptLog: attemptLog,
        colo: colo,
        targetHost: parsed.hostname,
        timeoutMs: timeoutMs,
      },
    },
  };
}
