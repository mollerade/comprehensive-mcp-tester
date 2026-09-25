/**
 * Cloudflare Worker host.
 *
 * Routes:
 *   GET  /                            → the UI (HTML is injected at build time as the HTML constant)
 *   GET  /oauth/callback              → the UI again; it hands the OAuth result to its opener
 *   GET  /oauth/client-metadata.json  → the tester's Client ID Metadata Document (CIMD)
 *   POST /proxy                       → proxyMcp(), same-origin callers only
 *
 * The Worker is public, and once credentials flow through it an open CORS proxy
 * would let any site drive it with a visitor's session. So /proxy rejects a
 * foreign Origin (403) and no response carries CORS grants, like the local host.
 *
 * The build wraps this file into two entry points:
 *   dist/worker.js   Service Worker format — paste into the dashboard editor
 *   dist/worker.mjs  ES module format      — for `wrangler deploy`
 * Both call handleRequest(request, allowedOriginsString).
 */
import { proxyMcp, parseAllowedOrigins } from '../core/proxy.js';
import { clientMetadataDocument, CLIENT_METADATA_PATH, CALLBACK_PATH } from '../core/oauth-client.js';

/* global HTML */

export async function handleRequest(request, allowedOriginsStr) {
  var url = new URL(request.url);

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '' || url.pathname === CALLBACK_PATH)) {
    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' } });
  }

  if (request.method === 'GET' && url.pathname === CLIENT_METADATA_PATH) {
    return cfJson(200, clientMetadataDocument(url.origin));
  }

  if (request.method === 'POST' && url.pathname === '/proxy') {
    var origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) {
      return cfJson(403, { error: 'Cross-origin requests to this proxy are not allowed' });
    }
    var payload;
    try {
      payload = await request.json();
    } catch (e) {
      return cfJson(400, { error: 'Invalid JSON in proxy request body' });
    }
    var result = await proxyMcp(payload, {
      fetch: fetch,
      allowedOrigins: parseAllowedOrigins(allowedOriginsStr),
      // Where this Worker instance runs — useful when flapping is PoP-specific
      colo: (request.cf && request.cf.colo) ? request.cf.colo : null,
    });
    return cfJson(result.status, result.json);
  }

  // No CORS grants: preflights from other origins get no Access-Control headers and fail
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  return new Response('Not found', { status: 404 });
}

export function cfJson(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json' },
  });
}
