/**
 * Mock MCP server (Streamable HTTP) for tests and demos.
 *
 *   npm run mock     → http://127.0.0.1:8788/mcp
 *
 * Behaves like a strict real server:
 *   - rejects requests that don't accept BOTH application/json and text/event-stream (406)
 *   - issues an mcp-session-id on initialize and requires it afterwards (400 otherwise)
 *   - answers notifications with 202 and no body
 *   - validates required tool arguments (JSON-RPC -32602)
 *
 * Behaviour is chosen by scenario (tests/fixtures/mock/scenarios/): any scenario is
 * served on /scenario/<name>/mcp, and GET /__scenarios lists them all. The original
 * paths stay as aliases:
 *   /mcp         normal
 *   /slow        normal, but every response is delayed 400ms
 *   /hang        never responds (timeouts)
 *   /fail        HTTP 503 on everything
 *   /stream      tools/call answers as text/event-stream instead of JSON
 *   /slow-list   normal, but tools/list answers after 800ms with its own tool list,
 *                so a late answer from a previous connection is recognisable
 *
 * Those are all legacy-era (initialize handshake, sessions), like most servers today.
 * Two more speak the 2026-07-28 stateless protocol:
 *   /modern      2026-07-28 only. Requires _meta protocol version plus matching
 *                MCP-Protocol-Version / Mcp-Method / Mcp-Name / Mcp-Param-* headers
 *                (400 -32020), rejects other versions (400 -32022), 404 -32601 for
 *                unknown methods, and rejects initialize.
 *   /dual        both: modern requests are served statelessly, initialize gets a session.
 *
 * OAuth-protected paths (MCP behaves like /mcp once a valid token is presented):
 *   /secure         401 with WWW-Authenticate resource_metadata + scope (the normal case)
 *   /secure-nohint  401 without resource_metadata: clients must probe the well-known URLs
 *   /secure-mixup   the authorization server redirects back with a wrong iss (mix-up attack)
 * served by a built-in authorization server at the same origin:
 *   /.well-known/oauth-protected-resource/<path>   RFC 9728 metadata (root: 404)
 *   /.well-known/oauth-authorization-server        RFC 8414 metadata (PKCE S256, iss, DCR, no CIMD)
 *   /.well-known/oauth-authorization-server/<p>    per-scenario issuers (e.g. as-no-s256)
 *   /register    dynamic client registration (records application_type)
 *   /authorize   auto-approves; requires PKCE S256 and a resource parameter; 302 with code, state, iss
 *   /token       authorization_code (checks PKCE, redirect_uri, resource) and client_credentials
 * Pre-registered clients: "pre-client" (public) and "cc-client" / "cc-secret" (confidential).
 *
 * Any request may add ?delay=<ms> (capped at 30s) to arrive late.
 */
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { reply, rpcErr, sleep } from './mock/protocol.mjs';
import { resolveScenario, scenarioForIssuerPath, listScenarios, SCENARIOS } from './mock/scenarios/index.mjs';
import { isMain } from '../../scripts/is-main.mjs';

export { TOOLS, MODERN_VERSION } from './mock/protocol.mjs';

const PRM_PREFIX = '/.well-known/oauth-protected-resource';
const AS_PREFIX = '/.well-known/oauth-authorization-server';
const MAX_DELAY_MS = 30000;
const FALLBACK = SCENARIOS.find((s) => s.name === 'mcp');   // any other path behaves like /mcp

function asMetadata(base, issuerPath = '', pkceMethods = ['S256']) {
  return {
    issuer: base + issuerPath, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token',
    registration_endpoint: base + '/register', response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
    code_challenge_methods_supported: pkceMethods, token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: true, scopes_supported: ['mcp:read', 'mcp:write'],
  };
}

const authOfPath = (path) => { const hit = resolveScenario(path); return (hit && hit.scenario && hit.scenario.auth) || null; };

/** RFC 9728 protected resource metadata for an auth scenario's path */
function serveResourceMetadata(res, base, resourcePath) {
  const auth = authOfPath(resourcePath);
  if (!auth) return reply(res, 404, { error: 'not_found' });
  reply(res, 200, { resource: base + resourcePath, authorization_servers: [base + (auth.issuerPath || '')],
    scopes_supported: ['mcp:read', 'mcp:write'], bearer_methods_supported: ['header'] });
}

/** RFC 8414 metadata: the root issuer, or a scenario's path-inserted one */
function serveAsMetadata(res, base, issuerPath) {
  if (!issuerPath) return reply(res, 200, asMetadata(base));
  const s = scenarioForIssuerPath(issuerPath);
  if (!s) return reply(res, 404, { error: 'not_found' });
  reply(res, 200, asMetadata(base, issuerPath, s.auth.pkceMethods));
}

function serveRegister(res, oauth, raw) {
  let body = {};
  try { body = JSON.parse(raw); } catch { /* empty */ }
  oauth.registrations.push(body);
  if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length) {
    return reply(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' });
  }
  const clientId = 'dcr-' + randomUUID();
  oauth.clients.set(clientId, { redirect_uris: body.redirect_uris, application_type: body.application_type });
  reply(res, 201, { client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), ...body });
}

/** Why an authorization request is refused, or null */
function authorizeRefusal(client, q) {
  if (!client) return 'Unknown client_id';
  if (client.redirect_uris && !client.redirect_uris.includes(q.redirect_uri)) return 'redirect_uri not registered';
  if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) return 'PKCE with S256 is required';
  if (!q.resource) return 'resource parameter is required';
  return null;
}

/** The iss the authorization response carries: the scenario's issuer, or a wrong one for the mix-up scenario */
function issuerFor(base, resource) {
  let auth = null;
  try { auth = authOfPath(new URL(resource).pathname); } catch { /* not a URL */ }
  if (auth && auth.mixup) return 'https://evil.example';
  return base + ((auth && auth.issuerPath) || '');
}

function serveAuthorize(res, oauth, base, url) {
  const q = Object.fromEntries(url.searchParams);
  oauth.authorizeRequests.push(q);
  const refusal = authorizeRefusal(oauth.clients.get(q.client_id), q);
  if (refusal) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end(refusal); }
  const code = randomUUID();
  oauth.codes.set(code, q);
  res.writeHead(302, { Location: q.redirect_uri + '?' + new URLSearchParams({ code, state: q.state, iss: issuerFor(base, q.resource) }) });
  res.end();
}

function clientOf(req, f) {
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!basic) return [f.client_id, f.client_secret];
  return Buffer.from(basic[1], 'base64').toString('utf8').split(':').map(decodeURIComponent);
}

/** Why an authorization_code grant is refused, or null */
function codeGrantRefusal(c, clientId, f) {
  if (!c) return 'Unknown or already used code';
  if (c.client_id !== clientId || c.redirect_uri !== f.redirect_uri) return 'client_id or redirect_uri does not match the authorization request';
  if (createHash('sha256').update(f.code_verifier || '').digest('base64url') !== c.code_challenge) return 'PKCE verification failed';
  if (f.resource !== c.resource) return 'resource does not match the authorization request';
  return null;
}

function serveToken(req, res, oauth, raw) {
  const f = Object.fromEntries(new URLSearchParams(raw));
  oauth.tokenRequests.push({ ...f, authorization: req.headers.authorization || null });
  const [clientId, secret] = clientOf(req, f);
  const issue = (resource, scope) => {
    const token = 'at-' + randomUUID();
    oauth.tokens.set(token, { resource, scope });
    reply(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600, scope });
  };
  if (f.grant_type === 'authorization_code') {
    const c = oauth.codes.get(f.code);
    oauth.codes.delete(f.code);
    const refusal = codeGrantRefusal(c, clientId, f);
    return refusal ? reply(res, 400, { error: 'invalid_grant', error_description: refusal }) : issue(c.resource, c.scope);
  }
  if (f.grant_type === 'client_credentials') {
    const cl = oauth.clients.get(clientId);
    if (!cl || !cl.secret || cl.secret !== secret) return reply(res, 401, { error: 'invalid_client' });
    return issue(f.resource, f.scope);
  }
  reply(res, 400, { error: 'unsupported_grant_type' });
}

/** The authorization server's routes; returns true when it answered */
function handleOAuth(req, res, oauth, path, base, raw) {
  if (path.startsWith(PRM_PREFIX)) { serveResourceMetadata(res, base, path.slice(PRM_PREFIX.length)); return true; }
  if (path === AS_PREFIX || path.startsWith(AS_PREFIX + '/')) { serveAsMetadata(res, base, path.slice(AS_PREFIX.length)); return true; }
  if (path === '/register' && req.method === 'POST') { serveRegister(res, oauth, raw); return true; }
  if (path === '/authorize') { serveAuthorize(res, oauth, base, new URL(req.url, base)); return true; }
  if (path === '/token' && req.method === 'POST') { serveToken(req, res, oauth, raw); return true; }
  return false;
}

/** 401 unless the request carries a token issued for exactly this resource */
function authChallenge(req, res, oauth, path, base, auth) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const grant = m && oauth.tokens.get(m[1]);
  if (grant && grant.resource === base + path) return false;
  const challenge = auth.hint === false ? 'Bearer realm="mock"'
    : `Bearer resource_metadata="${base}${PRM_PREFIX}${path}", scope="mcp:read"` + (m ? ', error="invalid_token"' : '');
  reply(res, 401, rpcErr(null, -32001, 'Unauthorized'), { 'WWW-Authenticate': challenge });
  return true;
}

function acceptsBoth(req) {
  const accept = req.headers.accept || '';
  return accept.includes('application/json') && accept.includes('text/event-stream');
}

/** Everything after routing: Accept check, JSON parse, record the call, run the scenario */
async function serveMcp(state, req, res, path, raw, scenario) {
  if (!acceptsBoth(req)) {
    return reply(res, 406, rpcErr(null, -32000, 'Not Acceptable: Client must accept both application/json and text/event-stream'));
  }
  let body;
  try { body = JSON.parse(raw); }
  catch { return reply(res, 400, rpcErr(null, -32700, 'Parse error')); }
  state.calls.push({ path, body, headers: req.headers });
  await scenario.handler({
    req, res, body, sessions: state.sessions,
    reply: (status, obj, headers) => reply(res, status, obj, headers),
    sse: (status, obj) => { res.writeHead(status, { 'Content-Type': 'text/event-stream' }); res.end('event: message\ndata: ' + JSON.stringify(obj) + '\n\n'); },
  });
}

/** ?delay=<ms>: hold the request before anything else happens */
function requestedDelay(url) {
  const delay = Number(url.searchParams.get('delay'));
  return delay > 0 ? sleep(Math.min(delay, MAX_DELAY_MS)) : null;
}

async function route(state, req, res, raw) {
  const base = 'http://' + req.headers.host;
  const url = new URL(req.url, base), path = url.pathname;
  await requestedDelay(url);

  if (req.method === 'GET' && path === '/__scenarios') return reply(res, 200, { scenarios: listScenarios() });
  if (handleOAuth(req, res, state.oauth, path, base, raw)) return;
  const hit = resolveScenario(path);
  if (hit && hit.unknown) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('unknown scenario: ' + hit.unknown); }
  const scenario = hit ? hit.scenario : FALLBACK;
  if (scenario.auth && authChallenge(req, res, state.oauth, path, base, scenario.auth)) return;
  if (scenario.raw) return scenario.handler({ req, res });
  return serveMcp(state, req, res, path, raw, scenario);
}

export function startMockServer(port = 0, host = '127.0.0.1') {
  const state = {
    sessions: new Set(),
    calls: [],   // every JSON-RPC body received, for assertions
    oauth: {
      clients: new Map([['pre-client', {}], ['cc-client', { secret: 'cc-secret' }]]),
      codes: new Map(), tokens: new Map(),
      registrations: [], authorizeRequests: [], tokenRequests: [],   // for assertions
    },
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => route(state, req, res, Buffer.concat(chunks).toString('utf8')).catch((e) => {
      // A broken scenario must fail its request, not leave it hanging
      if (!res.headersSent) reply(res, 500, { error: 'mock error: ' + e.message });
      else res.end();
    }));
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const base = `http://${host}:${server.address().port}`;
      resolve({
        base,
        url: base + '/mcp',
        calls: state.calls,
        oauth: state.oauth,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

/** Test helper: startMock({ port: 0 }) → { url, base, calls, oauth, close }, parallel-safe */
export function startMock({ port = 0, host = '127.0.0.1' } = {}) {
  return startMockServer(port, host);
}

if (isMain(import.meta.url)) {
  const port = parseInt(process.env.PORT || '8788', 10);
  startMockServer(port).then((m) => {
    console.log(`Mock MCP server at ${m.url}`);
    console.log(`Failure modes: ${m.base}/slow  ${m.base}/hang  ${m.base}/fail  ${m.base}/stream`);
    console.log(`2026-07-28 protocol: ${m.base}/modern (stateless only)  ${m.base}/dual (both eras)`);
    console.log(`OAuth: ${m.base}/secure  ${m.base}/secure-nohint  ${m.base}/secure-mixup  (client credentials: cc-client / cc-secret)`);
    console.log(`Scenarios: ${m.base}/scenario/<name>/mcp  (list: ${m.base}/__scenarios)`);
  });
}
