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
 *   MCP_TESTER_ALLOWED_TARGETS  hosts or origins the proxy may reach, e.g. "developer.hsbc.com,http://127.0.0.1:8788"
 *                             (empty = any public host; special-purpose addresses only when listed; ALLOWED_ORIGINS is the old name)
 *   MCP_TESTER_ALLOWED_HOSTS  extra Host header values to accept, e.g. "mcp-tester.internal:8787"
 *   MCP_TESTER_TOKEN          access token, 32+ characters; required when HOST is not loopback
 *
 * Unlike the public Worker, this host is NOT an open CORS proxy. A local proxy
 * sits inside your network, so any web page you visit could try to use it to
 * reach internal systems. It therefore:
 *   - binds to loopback by default
 *   - rejects Host headers it doesn't recognise (blocks DNS rebinding)
 *   - rejects /proxy calls carrying a foreign Origin
 *   - requires Content-Type: application/json (forces a CORS preflight, which it never grants)
 *   - refuses special-purpose targets (loopback, private, link-local, metadata) unless
 *     listed, checking the addresses a name resolves to at connect time
 *   - will not listen beyond loopback without MCP_TESTER_TOKEN; with a token, every
 *     request needs it (the printed access link sets a cookie; scripts send a Bearer header)
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { proxyMcp, parseAllowedOrigins } from '../core/proxy.js';
import { parseTargetList } from '../core/target-policy.js';
import { createGuardedFetch } from './guarded-fetch.js';
import { clientMetadataDocument, CLIENT_METADATA_PATH, CALLBACK_PATH } from '../core/oauth-client.js';
import { CONTENT_SECURITY_POLICY } from '../core/security-headers.js';
import { assembleHtml } from '../ui/assemble.js';

const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
export const MIN_TOKEN_LENGTH = 32;
const AUTH_COOKIE = 'mcp_tester_auth';
const ACCESS_PATH = '/access';

/** True when binding here keeps the server reachable from this machine only */
export function isLoopbackBind(host) {
  host = String(host || '').replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** Why this server must not start (a message for the terminal), or null */
export function startupProblem(host, token) {
  if (isLoopbackBind(host)) return null;
  if (!token) {
    return 'HOST=' + host + ' makes /proxy reachable from other machines, so it needs an access token.\n' +
      'Set MCP_TESTER_TOKEN to a random string of ' + MIN_TOKEN_LENGTH + '+ characters, e.g. MCP_TESTER_TOKEN=$(openssl rand -hex 32)';
  }
  if (token.length < MIN_TOKEN_LENGTH) return 'MCP_TESTER_TOKEN must be at least ' + MIN_TOKEN_LENGTH + ' characters.';
  return null;
}

const digest = (s) => createHash('sha256').update(String(s)).digest();
/** Constant-time, whatever the lengths: compare SHA-256 digests */
function sameSecret(a, b) { return timingSafeEqual(digest(a), digest(b)); }
/** The cookie holds an HMAC of the token, never the token itself */
function cookieValue(token) { return createHmac('sha256', token).update('mcp-tester-session-v1').digest('hex'); }

function cookieFrom(req, name) {
  const parts = String(req.headers.cookie || '').split(';');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i !== -1 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim();
  }
  return null;
}

/**
 * With a token set, every request needs it. Answers the request and returns
 * true when it was the access link or lacked the token; false lets it through.
 */
function tokenGate(req, res, url, token) {
  // The access link: trade the token for a cookie, and drop it from the address bar
  if (req.method === 'GET' && url.pathname === ACCESS_PATH) {
    if (!sameSecret(url.searchParams.get('token') || '', token)) {
      send(res, 401, { 'Content-Type': 'text/plain' }, 'Wrong or missing token.');
      return true;
    }
    send(res, 303, {
      Location: '/',
      'Set-Cookie': AUTH_COOKIE + '=' + cookieValue(token) + '; HttpOnly; SameSite=Lax; Path=/',
      'Cache-Control': 'no-store',
    }, '');
    return true;
  }
  // The authorization server fetches the client metadata document itself, without the cookie
  if ((req.method === 'GET' && url.pathname === CLIENT_METADATA_PATH) || authorised(req, token)) return false;
  send(res, 401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer realm="mcp-tester"' },
    'This MCP Tester needs its access token. Open the access link printed in the terminal where it was started.');
  return true;
}

function authorised(req, token) {
  const auth = String(req.headers.authorization || '');
  if (/^Bearer /i.test(auth) && sameSecret(auth.slice(7).trim(), token)) return true;
  const c = cookieFrom(req, AUTH_COOKIE);
  return c !== null && sameSecret(c, cookieValue(token));
}

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

/** Options first, then the environment */
function serverConfig(opts) {
  const allowTargets = parseTargetList(opts.allowedTargets ?? opts.allowedOrigins ??
    process.env.MCP_TESTER_ALLOWED_TARGETS ?? process.env.ALLOWED_ORIGINS);
  return {
    allowTargets,
    extraHosts: parseAllowedOrigins(opts.allowedHosts ?? process.env.MCP_TESTER_ALLOWED_HOSTS),
    token: opts.token ?? process.env.MCP_TESTER_TOKEN ?? '',
    doFetch: opts.fetch || createGuardedFetch({ allow: allowTargets }),
  };
}

/** POST /proxy: same-origin JSON only, then proxyMcp() */
async function handleProxy(req, res, hostHeader, proxyEnv) {
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
  catch { return sendJson(res, 400, { error: 'Invalid JSON in proxy request body' }); }
  const result = await proxyMcp(payload, proxyEnv);
  return sendJson(res, result.status, result.json);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.allowedTargets]  comma list of target hosts or origins (defaults to env MCP_TESTER_ALLOWED_TARGETS,
 *                                        then ALLOWED_ORIGINS); opts.allowedOrigins is the old name
 * @param {string} [opts.allowedHosts]    comma list of extra Host header values
 * @param {string} [opts.token]           access token (defaults to env MCP_TESTER_TOKEN); empty = none
 * @param {Function} [opts.fetch]         fetch implementation (tests)
 */
export function createServer(opts = {}) {
  const { allowTargets, extraHosts, token, doFetch } = serverConfig(opts);

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
      if (token && tokenGate(req, res, url, token)) return;

      // The OAuth callback is the same page: it hands the result to the window that opened it
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === CALLBACK_PATH)) {
        return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CONTENT_SECURITY_POLICY }, assembleHtml());
      }

      if (req.method === 'GET' && url.pathname === CLIENT_METADATA_PATH) {
        return sendJson(res, 200, clientMetadataDocument('http://' + hostHeader));
      }

      if (req.method === 'POST' && url.pathname === '/proxy') {
        return await handleProxy(req, res, hostHeader, { fetch: doFetch, allowTargets, allowAnyPublic: true, colo: 'local' });
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
  const token = process.env.MCP_TESTER_TOKEN || '';
  const problem = startupProblem(host, token);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Try PORT=${port + 1} npm start`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    const base = `http://${shown}:${server.address().port}`;
    console.log(`MCP Tester running at ${base}`);
    if (token) console.log(`Access link (sets a cookie; scripts send Authorization: Bearer <token>): ${base}${ACCESS_PATH}?token=${encodeURIComponent(token)}`);
    const targets = process.env.MCP_TESTER_ALLOWED_TARGETS ?? process.env.ALLOWED_ORIGINS;
    console.log(targets ? `Proxy restricted to: ${targets}` : 'Proxy reaches public hosts; set MCP_TESTER_ALLOWED_TARGETS to test a local or internal server');
  });
}
