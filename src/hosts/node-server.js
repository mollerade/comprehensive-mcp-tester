#!/usr/bin/env node
/**
 * Local Node host — the same UI and proxy, served from your own machine.
 *
 *   npm start                     → http://127.0.0.1:8787
 *   PORT=9000 npm start
 *   npx mcp-tester                 (once published)
 *
 * Environment
 *   PORT                      default 8787
 *   HOST                      default 127.0.0.1 (loopback only)
 *   ALLOWED_ORIGINS           target MCP hosts the proxy may reach, e.g. "developer.hsbc.com" (empty = any)
 *   MCP_TESTER_ALLOWED_HOSTS  extra Host header values to accept, e.g. "mcp-tester.internal:8787"
 *
 * Unlike the public Worker, this host is NOT an open CORS proxy. A local proxy
 * sits inside your network, so any web page you visit could try to use it to
 * reach internal systems. It therefore:
 *   - binds to loopback by default
 *   - rejects Host headers it doesn't recognise (blocks DNS rebinding)
 *   - rejects /proxy calls carrying a foreign Origin
 *   - requires Content-Type: application/json (forces a CORS preflight, which it never grants)
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { proxyMcp, parseAllowedOrigins } from '../core/proxy.js';
import { clientMetadataDocument, CLIENT_METADATA_PATH, CALLBACK_PATH } from '../core/oauth-client.js';
import { CONTENT_SECURITY_POLICY } from '../core/security-headers.js';
import { assembleHtml } from '../ui/assemble.js';

const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }, headers));
  res.end(body);
}
/** The detail stays in the terminal, not in the response */
function sendInternalError(res, err) {
  console.error(err);
  sendJson(res, 500, { error: 'Internal error' });
}
function sendJson(res, status, obj) {
  send(res, status, { 'Content-Type': 'application/json' }, JSON.stringify(obj));
}

function hostnameOf(hostHeader) {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    const chunks = [];
    req.on('data', (c) => {
      if (overflow) return;                       // keep draining, stop buffering
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        // Reject now so the caller can answer 413; the socket is closed only
        // after that response is sent, so the client sees the status code.
        reject(Object.assign(new Error('too large'), { code: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!overflow) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

/**
 * @param {object} [opts]
 * @param {string} [opts.allowedOrigins]  comma list of target hosts (defaults to env ALLOWED_ORIGINS)
 * @param {string} [opts.allowedHosts]    comma list of extra Host header values
 * @param {Function} [opts.fetch]         fetch implementation (tests)
 */
export function createServer(opts = {}) {
  const allowedOrigins = parseAllowedOrigins(opts.allowedOrigins ?? process.env.ALLOWED_ORIGINS);
  const extraHosts = parseAllowedOrigins(opts.allowedHosts ?? process.env.MCP_TESTER_ALLOWED_HOSTS);
  const doFetch = opts.fetch || fetch;

  const hostAllowed = (hostHeader) => {
    if (!hostHeader) return false;
    if (extraHosts.includes(hostHeader) || extraHosts.includes(hostnameOf(hostHeader))) return true;
    return LOOPBACK_HOSTS.includes(hostnameOf(hostHeader));
  };

  return http.createServer(async (req, res) => {
    try {
      const hostHeader = req.headers.host || '';
      if (!hostAllowed(hostHeader)) {
        return send(res, 421, { 'Content-Type': 'text/plain' },
          'Unrecognised Host header. Set MCP_TESTER_ALLOWED_HOSTS to serve this hostname.');
      }
      const url = new URL(req.url, 'http://' + hostHeader);

      // The OAuth callback is the same page: it hands the result to the window that opened it
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === CALLBACK_PATH)) {
        return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CONTENT_SECURITY_POLICY }, assembleHtml());
      }

      if (req.method === 'GET' && url.pathname === CLIENT_METADATA_PATH) {
        return sendJson(res, 200, clientMetadataDocument('http://' + hostHeader));
      }

      if (req.method === 'POST' && url.pathname === '/proxy') {
        const origin = req.headers.origin;
        if (origin && origin !== 'http://' + hostHeader && origin !== 'https://' + hostHeader) {
          return sendJson(res, 403, { error: 'Cross-origin requests to the local proxy are not allowed' });
        }
        if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
          return sendJson(res, 415, { error: 'Content-Type must be application/json' });
        }
        let raw;
        try { raw = await readBody(req); }
        catch (e) {
          if (e.code === 413) {
            res.on('finish', () => req.destroy());
            return send(res, 413, { 'Content-Type': 'application/json', Connection: 'close' },
              JSON.stringify({ error: 'Request body too large (limit 1 MB)' }));
          }
          return sendJson(res, 400, { error: 'Could not read request body' });
        }
        let payload;
        try { payload = JSON.parse(raw); }
        catch (e) { return sendJson(res, 400, { error: 'Invalid JSON in proxy request body' }); }
        const result = await proxyMcp(payload, { fetch: doFetch, allowedOrigins, colo: 'local' });
        return sendJson(res, result.status, result.json);
      }

      // No CORS grants: preflights from other origins get no Access-Control headers and fail
      if (req.method === 'OPTIONS') return send(res, 204, {}, '');

      return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
    } catch (err) {
      return sendInternalError(res, err);
    }
  });
}

/* Run directly: node src/hosts/node-server.js. Node resolves import.meta.url
   through symlinks but leaves argv[1] as typed, so compare real paths, or a
   checkout or install under a symlinked directory would silently not start. */
function isMain() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
}

if (isMain()) {
  const port = parseInt(process.env.PORT || '8787', 10);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Try PORT=${port + 1} npm start`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`MCP Tester running at http://${shown}:${server.address().port}`);
    if (process.env.ALLOWED_ORIGINS) console.log(`Proxy restricted to: ${process.env.ALLOWED_ORIGINS}`);
  });
}
