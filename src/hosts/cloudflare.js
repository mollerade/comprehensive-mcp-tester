/**
 * Cloudflare Worker host.
 *
 * Routes (identical to v7):
 *   GET  /        → the UI (HTML is injected at build time as the HTML constant)
 *   POST /proxy   → proxyMcp()
 *   OPTIONS *     → CORS preflight
 *
 * The build wraps this file into two entry points:
 *   dist/worker.js   Service Worker format — paste into the dashboard editor
 *   dist/worker.mjs  ES module format      — for `wrangler deploy`
 * Both call handleRequest(request, allowedOriginsString).
 */
import { proxyMcp, parseAllowedOrigins } from '../core/proxy.js';

/* global HTML */

export async function handleRequest(request, allowedOriginsStr) {
  var url = new URL(request.url);

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (request.method === 'POST' && url.pathname === '/proxy') {
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

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  return new Response('Not found', { status: 404 });
}

export function cfJson(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
