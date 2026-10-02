/**
 * Host adapters: the built Cloudflare bundles and the local Node server.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build, platformViolations } from '../scripts/build.mjs';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
import { assembleHtml } from '../src/ui/assemble.js';
import { createServer, startupProblem, isLoopbackBind } from '../src/hosts/node-server.js';
import { createGuardedFetch } from '../src/hosts/guarded-fetch.js';
import { proxyMcp } from '../src/core/proxy.js';
import { startMockServer } from './fixtures/mock-mcp-server.mjs';

let mock;
before(async () => { mock = await startMockServer(); });
after(async () => { await mock.close(); });

const initPayload = (url) => JSON.stringify({
  url, timeoutMs: 3000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
});

describe('Cloudflare Service Worker bundle (dist/worker.js)', () => {
  let handler;
  const load = (globals = { MCP_TESTER_ALLOWED_TARGETS: '127.0.0.1' }) => {
    const { sw } = build({ write: false });
    const ctx = vm.createContext({
      addEventListener: (type, fn) => { if (type === 'fetch') handler = fn; },
      Request, Response, Headers, URL, fetch, AbortController, setTimeout, clearTimeout, Date, JSON, console,
      ...globals,
    });
    vm.runInContext(sw, ctx, { filename: 'worker.js' });
  };
  const dispatch = (request) => new Promise((resolve) => handler({ request, respondWith: (p) => resolve(p) }));

  test('registers a fetch handler and serves the UI at /', async () => {
    load();
    const res = await dispatch(new Request('https://w.dev/'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(await res.text(), assembleHtml());
  });

  test('POST /proxy reaches an MCP server', async () => {
    load();
    const res = await dispatch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload(mock.url) }));
    const env = await res.json();
    assert.equal(env.status, 200);
    assert.ok(env.headers['mcp-session-id']);
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS grants');
  });

  test('security: foreign Origin on /proxy → 403; same origin accepted', async () => {
    load();
    const foreign = await dispatch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload(mock.url), headers: { Origin: 'https://evil.example' } }));
    assert.equal(foreign.status, 403);
    const same = await dispatch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload(mock.url), headers: { Origin: 'https://w.dev' } }));
    assert.equal(same.status, 200);
  });

  test('OAuth: callback serves the UI; client metadata document names this origin', async () => {
    load();
    const cb = await dispatch(new Request('https://w.dev/oauth/callback?code=x&state=y'));
    assert.equal(await cb.text(), assembleHtml());
    const doc = await (await dispatch(new Request('https://w.dev/oauth/client-metadata.json'))).json();
    assert.equal(doc.client_id, 'https://w.dev/oauth/client-metadata.json');
    assert.deepEqual(doc.redirect_uris, ['https://w.dev/oauth/callback']);
    assert.equal(doc.token_endpoint_auth_method, 'none');
  });

  test('invalid JSON → 400, unknown path → 404, OPTIONS → 204', async () => {
    load();
    assert.equal((await dispatch(new Request('https://w.dev/proxy', { method: 'POST', body: '{nope' }))).status, 400);
    assert.equal((await dispatch(new Request('https://w.dev/nope'))).status, 404);
    assert.equal((await dispatch(new Request('https://w.dev/proxy', { method: 'OPTIONS' }))).status, 204);
  });

  test('ALLOWED_ORIGINS global restricts targets', async () => {
    load({ ALLOWED_ORIGINS: 'developer.hsbc.com' });
    const res = await dispatch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload(mock.url) }));
    assert.equal(res.status, 403);
  });
});

describe('Cloudflare module bundle (dist/worker.mjs)', () => {
  test('default export fetch() serves UI and proxies, honouring env.ALLOWED_ORIGINS', async () => {
    const { mod } = build({ write: false });
    const file = join(mkdtempSync(join(tmpdir(), 'mcpt-')), 'worker.mjs');
    writeFileSync(file, mod);
    const worker = (await import(pathToFileURL(file).href)).default;
    const page = await worker.fetch(new Request('https://w.dev/'), {});
    assert.equal(await page.text(), assembleHtml());
    const ok = await worker.fetch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload(mock.url) }), { MCP_TESTER_ALLOWED_TARGETS: '127.0.0.1' });
    assert.equal((await ok.json()).status, 200);
    const blocked = await worker.fetch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload(mock.url) }), { ALLOWED_ORIGINS: 'x.com' });
    assert.equal(blocked.status, 403);
  });
});

describe('Local Node server', () => {
  let server, base;
  before(async () => {
    server = createServer({ allowedTargets: '127.0.0.1', allowedHosts: '', token: '' });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

  const post = (body, headers = {}) => fetch(base + '/proxy', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers },
  });

  test('serves the assembled UI with no-store', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), assembleHtml());
  });

  test('proxies to an MCP server and reports colo "local"', async () => {
    const env = await (await post(initPayload(mock.url))).json();
    assert.equal(env.status, 200);
    assert.equal(env.diag.colo, 'local');
  });

  test('same-origin Origin header is accepted', async () => {
    const res = await post(initPayload(mock.url), { Origin: base });
    assert.equal(res.status, 200);
  });

  test('security: foreign Origin → 403', async () => {
    const res = await post(initPayload(mock.url), { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });

  test('security: non-JSON content type → 415 (blocks simple cross-site form posts)', async () => {
    const res = await fetch(base + '/proxy', { method: 'POST', body: initPayload(mock.url), headers: { 'Content-Type': 'text/plain' } });
    assert.equal(res.status, 415);
  });

  test('security: unrecognised Host header → 421 (DNS rebinding)', async () => {
    const http = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = http.request(base + '/', { headers: { Host: 'attacker.example:8787' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 421);
  });

  test('OAuth: callback serves the UI; client metadata document names this origin', async () => {
    assert.equal(await (await fetch(base + '/oauth/callback?code=x')).text(), assembleHtml());
    const doc = await (await fetch(base + '/oauth/client-metadata.json')).json();
    assert.equal(doc.client_id, base + '/oauth/client-metadata.json');
    assert.deepEqual(doc.redirect_uris, [base + '/oauth/callback']);
  });

  test('security: preflight gets no CORS grant', async () => {
    const res = await fetch(base + '/proxy', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('oversized body → 413; invalid JSON → 400; unknown path → 404', async () => {
    assert.equal((await post('x'.repeat(1024 * 1024 + 10))).status, 413);
    assert.equal((await post('{nope')).status, 400);
    assert.equal((await fetch(base + '/nope')).status, 404);
  });

  test('extra allowed hosts can be configured', async () => {
    const s2 = createServer({ allowedHosts: 'mcp-tester.internal' });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    const http = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${s2.address().port}/`, { headers: { Host: 'mcp-tester.internal:8787' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    await new Promise((r) => s2.close(r));
    assert.equal(status, 200);
  });
});

test('AC-SPEC-ENGINE-07: platform-free', () => {
  assert.deepEqual(platformViolations(join(ROOT_DIR, 'src', 'core')), []);
  assert.doesNotThrow(() => build({ write: false }));

  const dir = mkdtempSync(join(tmpdir(), 'core-'));
  try {
    mkdirSync(join(dir, 'compliance'));
    writeFileSync(join(dir, 'compliance', 'bad.js'), "import { readFileSync } from 'node:fs';\n");
    writeFileSync(join(dir, 'worker-only.js'), 'const r = new HTMLRewriter();\n');
    const found = platformViolations(dir).join('\n');
    assert.match(found, /bad\.js: imports a node: module/);
    assert.match(found, /worker-only\.js: uses a Cloudflare-only API/);
    assert.throws(() => build({ write: false, coreDir: dir }), /src\/core must stay platform-free/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the compliance engine runs unchanged inside the Worker bundle', () => {
  const { sw } = build({ write: false });
  const ctx = vm.createContext({ addEventListener: () => {}, Request, Response, Headers, URL, fetch, AbortController, setTimeout, clearTimeout, Date, JSON, console });
  vm.runInContext(sw, ctx, { filename: 'worker.js' });
  const report = vm.runInContext("runCompliance(COMPLIANCE_CATALOGUE, { claimedVersion: '2099-01-01' })", ctx);
  assert.equal(report.bestEffort, true);
  assert.equal(report.verdict, 'warn');
  assert.equal(report.results.find((r) => r.id === 'MCP-VER-001').status, 'warn');
});

/** Run node-server.js from `serverPath` with PORT=0; resolves with its announced URL */
function runServer(serverPath) {
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1' } });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('no startup line: ' + out)); }, 10000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = /running at (http:\/\/\S+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ child, url: m[1] }); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('server exited ' + code + ' without starting: ' + (out || '(no output)'))); });
  });
}

test('the local server starts when run through a symlinked path, and announces its real port', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'symlinked-'));
  try {
    cpSync(join(ROOT_DIR, 'src'), join(dir, 'real', 'src'), { recursive: true });
    cpSync(join(ROOT_DIR, 'package.json'), join(dir, 'real', 'package.json'));
    symlinkSync(join(dir, 'real'), join(dir, 'link'), 'dir');
    const { child, url } = await runServer(join(dir, 'link', 'src', 'hosts', 'node-server.js'));
    try {
      assert.doesNotMatch(url, /:0$/, 'announced port 0 instead of the bound port');
      assert.equal((await fetch(url + '/')).status, 200);
    } finally {
      child.kill();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-SEC-CSP-01: both hosts send the policy', async () => {
  const required = ["connect-src 'self'", "frame-ancestors 'none'", "default-src 'none'", "base-uri 'none'", "form-action 'self'"];
  const check = (where, headers) => {
    const csp = headers.get('content-security-policy');
    assert.ok(csp, where + ' sends no Content-Security-Policy');
    for (const d of required) assert.ok(csp.split(/;\s*/).includes(d), where + ' policy lacks ' + d + ': ' + csp);
  };

  // Cloudflare bundle, executed as built
  let handler;
  const ctx = vm.createContext({ addEventListener: (t, fn) => { if (t === 'fetch') handler = fn; }, Request, Response, Headers, URL, fetch, AbortController, setTimeout, clearTimeout, Date, JSON, console });
  vm.runInContext(build({ write: false }).sw, ctx, { filename: 'worker.js' });
  for (const path of ['/', '/oauth/callback']) {
    const res = await new Promise((resolve) => handler({ request: new Request('https://tester.example' + path), respondWith: resolve }));
    check('worker ' + path, res.headers);
  }

  // Local Node server
  const server = createServer({ allowedOrigins: '', allowedHosts: '' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    for (const path of ['/', '/oauth/callback']) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
      check('node ' + path, res.headers);
    }
  } finally {
    await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  }
});

// ── Target policy and access token (SEC-PROXY) ──

test('AC-SEC-PROXY-06: the local server checks the addresses a name resolves to', async () => {
  const port = new URL(mock.url).port;
  // localhost is a name: the socket lookup resolves it to loopback and refuses
  const guarded = createGuardedFetch({ allow: [] });
  await assert.rejects(guarded(`http://localhost:${port}/mcp`, { method: 'GET' }), (e) => e.code === 'MCP_TESTER_TARGET_REFUSED' && /resolves to/.test(e.message));
  // Through the proxy it is a 403, not a transport failure
  const r = await proxyMcp({ url: `http://localhost:${port}/mcp`, method: 'GET' }, { fetch: guarded, allowTargets: ['localhost'] });
  assert.equal(r.status, 403, 'the proxy policy let it through by name, but the connect-time check still refused');
  // Listed for the guarded fetch: connects
  const listed = createGuardedFetch({ allow: ['localhost'] });
  const res = await listed(`http://localhost:${port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('mcp-session-id'));
  assert.match(await res.text(), /protocolVersion/);
});

test('AC-SEC-PROXY-07: the Worker is closed until targets are configured', async () => {
  const { sw, mod } = build({ write: false });
  let handler;
  const ctx = vm.createContext({ addEventListener: (t, fn) => { if (t === 'fetch') handler = fn; }, Request, Response, Headers, URL, fetch, AbortController, setTimeout, clearTimeout, Date, JSON, console });
  vm.runInContext(sw, ctx, { filename: 'worker.js' });
  const res = await new Promise((resolve) => handler({ request: new Request('https://w.dev/proxy', { method: 'POST', body: initPayload('https://example.com/mcp') }), respondWith: resolve }));
  assert.equal(res.status, 403);
  assert.match((await res.json()).hint, /MCP_TESTER_ALLOWED_TARGETS/);

  const file = join(mkdtempSync(join(tmpdir(), 'mcpt-')), 'worker.mjs');
  writeFileSync(file, mod);
  const worker = (await import(pathToFileURL(file).href)).default;
  const closed = await worker.fetch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload('https://example.com/mcp') }), {});
  assert.equal(closed.status, 403);
  const star = await worker.fetch(new Request('https://w.dev/proxy', { method: 'POST', body: initPayload(mock.url) }), { MCP_TESTER_ALLOWED_TARGETS: '*' });
  assert.equal(star.status, 403, '* does not include loopback');
  // '*' with the Worker's closed default lets a public target through (fake fetch: no network in tests)
  const pub = await proxyMcp({ url: 'https://example.com/mcp', method: 'GET' }, { fetch: async () => new Response('{}'), allowTargets: ['*'], allowAnyPublic: false });
  assert.equal(pub.json.status, 200);
});

test('AC-SEC-PROXY-08: the local server will not listen beyond loopback without a token', async () => {
  for (const h of ['127.0.0.1', '127.0.0.2', 'localhost', '::1', '[::1]']) assert.equal(isLoopbackBind(h), true, h);
  for (const h of ['0.0.0.0', '::', '192.168.1.10']) assert.equal(isLoopbackBind(h), false, h);
  assert.equal(startupProblem('127.0.0.1', ''), null);
  assert.match(startupProblem('0.0.0.0', ''), /MCP_TESTER_TOKEN/);
  assert.match(startupProblem('0.0.0.0', 'short'), /at least 32/);
  assert.equal(startupProblem('0.0.0.0', 'x'.repeat(32)), null);

  // The real entry point exits instead of starting
  const child = spawn(process.execPath, [join(ROOT_DIR, 'src/hosts/node-server.js')], {
    env: { ...process.env, HOST: '0.0.0.0', PORT: '0', MCP_TESTER_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 1);
  assert.match(stderr, /needs an access token/);
});

test('AC-SEC-PROXY-09: with a token, every request needs it', async () => {
  const token = 't'.repeat(40);
  const server = createServer({ allowedTargets: '127.0.0.1', allowedHosts: '', token });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const proxy = (headers) => fetch(base + '/proxy', { method: 'POST', body: initPayload(mock.url), headers: { 'Content-Type': 'application/json', ...headers } });
  try {
    assert.equal((await fetch(base + '/')).status, 401);
    assert.equal((await proxy({})).status, 401);
    assert.equal((await fetch(base + '/oauth/client-metadata.json')).status, 200, 'the authorization server can fetch the metadata document');
    assert.equal((await fetch(base + '/access?token=wrong', { redirect: 'manual' })).status, 401);

    const link = await fetch(base + '/access?token=' + token, { redirect: 'manual' });
    assert.equal(link.status, 303);
    assert.equal(link.headers.get('location'), '/');
    const setCookie = link.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.equal(setCookie.includes(token), false, 'the cookie holds an HMAC, not the token');
    const cookie = setCookie.split(';')[0];

    assert.equal((await fetch(base + '/', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await (await proxy({ Cookie: cookie })).json()).status, 200);
    assert.equal((await (await proxy({ Authorization: 'Bearer ' + token })).json()).status, 200, 'scripts send the token as a Bearer header');
    assert.equal((await proxy({ Authorization: 'Bearer ' + token + 'x' })).status, 401);
    assert.equal((await proxy({ Cookie: 'mcp_tester_auth=' + 'a'.repeat(64) })).status, 401);
  } finally {
    await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  }
});
