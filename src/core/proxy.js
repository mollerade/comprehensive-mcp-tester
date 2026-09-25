/**
 * MCP proxy core — platform-agnostic.
 *
 * Forwards one MCP JSON-RPC request to a target server and returns an
 * envelope carrying the origin's status, headers and body plus timing
 * diagnostics. It has no knowledge of Cloudflare, Node or any host: hosts
 * parse the incoming request, call proxyMcp(), and serialise the result.
 *
 * Contract (unchanged from v7, relied on by the UI):
 *   input  { url, method?, headers?, body?, timeoutMs?, retries? }
 *   output { status, json }  where json is either
 *          { error }                                  (bad input, 4xx)
 *          { status, headers, body, diag }             (origin reached or failed)
 *
 * A failed transport (timeout / network) is reported with HTTP 200 and
 * envelope status 0, so the UI can always read the diagnostics.
 */

export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_TIMEOUT_MS = 120000;
export const MAX_RETRIES = 3;

// Hop-by-hop and identity headers never forwarded to the origin
export const SKIP_HEADERS = ['host', 'origin', 'referer', 'connection', 'upgrade', 'transfer-encoding', 'content-length'];

export function clampInt(v, lo, hi, dflt) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** "a.com, b.com" → ["a.com","b.com"]; empty/undefined → [] (no restriction) */
export function parseAllowedOrigins(str) {
  return String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

/**
 * @param {object} payload  parsed proxy request from the UI
 * @param {object} env
 * @param {Function} env.fetch          fetch implementation (global fetch in every host)
 * @param {string[]} [env.allowedOrigins] target hostnames allowed; empty = any
 * @param {string|null} [env.colo]      where this proxy instance runs (diagnostics only)
 */
export async function proxyMcp(payload, env) {
  env = env || {};
  var doFetch = env.fetch || fetch;
  var allowed = env.allowedOrigins || [];
  var colo = env.colo || null;

  payload = payload || {};
  var targetUrl = payload.url;
  var method = String(payload.method || 'POST').toUpperCase();
  var headers = payload.headers || {};
  var body = payload.body || null;
  var timeoutMs = clampInt(payload.timeoutMs, 500, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  var retries = clampInt(payload.retries, 0, MAX_RETRIES, 0);

  if (!targetUrl) return { status: 400, json: { error: "Missing 'url' in request" } };

  var parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return { status: 400, json: { error: 'Invalid target URL' } };
  }

  if (allowed.length > 0 && allowed.indexOf(parsed.hostname) === -1) {
    return { status: 403, json: { error: 'Target domain not in allowlist', allowed: allowed } };
  }

  var outHeaders = new Headers();
  var hKeys = Object.keys(headers);
  for (var i = 0; i < hKeys.length; i++) {
    if (SKIP_HEADERS.indexOf(hKeys[i].toLowerCase()) === -1) outHeaders.set(hKeys[i], headers[hKeys[i]]);
  }

  // MCP Streamable HTTP requires the client to accept BOTH content types.
  // Enforced here so it can never be missing or partial.
  var accept = outHeaders.get('accept') || '';
  if (accept.indexOf('application/json') === -1 || accept.indexOf('text/event-stream') === -1) {
    outHeaders.set('accept', 'application/json, text/event-stream');
  }
  if (!outHeaders.get('content-type') && method !== 'GET' && method !== 'HEAD') {
    outHeaders.set('content-type', 'application/json');
  }

  var attemptLog = [];
  var lastErr = null;

  for (var attempt = 1; attempt <= retries + 1; attempt++) {
    // On Workers the clock advances on I/O, so spans around an awaited fetch are real.
    var t0 = Date.now();
    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);

    try {
      var resp = await doFetch(targetUrl, {
        method: method,
        headers: outHeaders,
        body: (method === 'GET' || method === 'HEAD') ? null : body,
        redirect: 'follow',
        signal: controller.signal,
      });

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
          },
        },
      };
    } catch (err) {
      clearTimeout(timer);
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
