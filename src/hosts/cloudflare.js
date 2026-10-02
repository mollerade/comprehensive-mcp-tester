/**
 * Cloudflare Worker host.
 *
 * Routes:
 *   GET  /                            → the UI (HTML is injected at build time as the HTML constant)
 *   GET  /oauth/callback              → the UI again; it hands the OAuth result to its opener
 *   GET  /oauth/client-metadata.json  → the tester's Client ID Metadata Document (CIMD)
 *   POST /proxy                       → proxyMcp(), same-origin callers only
 *   POST /compliance                  → runComplianceCheck(): probes the server through proxyMcp and grades it
 *
 * The Worker is public, and once credentials flow through it an open CORS proxy
 * would let any site drive it with a visitor's session. So /proxy rejects a
 * foreign Origin (403) and no response carries CORS grants, like the local host.
 *
 * The Origin check stops other web pages, not direct requests, so a public
 * Worker would also be a fetch relay for anyone who finds its URL. It is
 * therefore closed by default: /proxy refuses every target until
 * MCP_TESTER_ALLOWED_TARGETS (or the older ALLOWED_ORIGINS) lists them, and
 * '*' opts in to any public target. The Worker has no DNS API, so only
 * literal special-purpose addresses are refused here.
 *
 * The build wraps this file into two entry points:
 *   dist/worker.js   Service Worker format — paste into the dashboard editor
 *   dist/worker.mjs  ES module format      — for `wrangler deploy`
 * Both call handleRequest(request, allowedTargetsString).
 */
import { proxyMcp } from '../core/proxy.js';
import { runComplianceCheck } from '../core/compliance/run.js';
import { parseTargetList } from '../core/target-policy.js';
import { clientMetadataDocument, CLIENT_METADATA_PATH, CALLBACK_PATH } from '../core/oauth-client.js';
import { CONTENT_SECURITY_POLICY } from '../core/security-headers.js';

/* global HTML */

export async function handleRequest(request, allowedTargetsStr) {
  var url = new URL(request.url);

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '' || url.pathname === CALLBACK_PATH)) {
    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CONTENT_SECURITY_POLICY } });
  }

  if (request.method === 'GET' && url.pathname === CLIENT_METADATA_PATH) {
    return cfJson(200, clientMetadataDocument(url.origin));
  }

  var run = request.method === 'POST' ? cfRoute(url.pathname, request, allowedTargetsStr) : null;
  if (run) return cfJsonPost(request, url, run);

  // No CORS grants: preflights from other origins get no Access-Control headers and fail
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  return new Response('Not found', { status: 404 });
}

/** The proxy env for this Worker: closed by default, and the PoP it runs in (useful when flapping is PoP-specific) */
function cfProxyEnv(request, allowedTargetsStr) {
  return {
    fetch: fetch,
    allowTargets: parseTargetList(allowedTargetsStr),
    allowAnyPublic: false,
    colo: (request.cf && request.cf.colo) ? request.cf.colo : null,
    signal: request.signal,
  };
}

/** POST routes: run(payload) → { status, json }, or null */
function cfRoute(path, request, allowedTargetsStr) {
  var env = cfProxyEnv(request, allowedTargetsStr);
  if (path === '/proxy') return function (payload) { return proxyMcp(payload, env); };
  if (path === '/compliance') return function (payload) { return runComplianceCheck(payload, env); };
  return null;
}

/** Same-origin JSON only, like the local host */
async function cfJsonPost(request, url, run) {
  var origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) {
    return cfJson(403, { error: 'Cross-origin requests to this proxy are not allowed' });
  }
  var payload;
  try {
    payload = await request.json();
  } catch {
    return cfJson(400, { error: 'Invalid JSON in proxy request body' });
  }
  var result = await run(payload);
  return cfJson(result.status, result.json);
}

export function cfJson(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json' },
  });
}
