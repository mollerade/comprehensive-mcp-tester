import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { proxyMcp, parseAllowedOrigins, clampInt } from '../src/core/proxy.js';
import { startMockServer } from './fixtures/mock-mcp-server.mjs';

let mock;
before(async () => { mock = await startMockServer(); });
after(async () => { await mock.close(); });

const ACCEPT = 'application/json, text/event-stream';
const init = (url, extra = {}) => ({
  url, method: 'POST', timeoutMs: 3000,
  headers: { 'Content-Type': 'application/json', Accept: ACCEPT },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
  ...extra,
});
// The mock runs on loopback, which the proxy reaches only when it is listed
const call = (payload, env = {}) => proxyMcp(payload, { fetch, allowTargets: ['127.0.0.1'], ...env });

test('fast response: ok envelope, status 200, session header passed through', async () => {
  const r = await call(init(mock.url));
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 200);
  assert.equal(r.json.diag.ok, true);
  assert.ok(r.json.headers['mcp-session-id'], 'session id forwarded to the client');
});

test('timings are present and consistent (ttfb + body = total, within 2ms)', async () => {
  const { json: { diag } } = await call(init(mock.url));
  for (const k of ['ttfbMs', 'bodyMs', 'totalMs']) assert.equal(typeof diag[k], 'number');
  assert.ok(Math.abs(diag.ttfbMs + diag.bodyMs - diag.totalMs) <= 2);
});

test('slow origin: ~400ms measured on the origin', async () => {
  const { json: { diag } } = await call(init(mock.base + '/slow'));
  assert.ok(diag.totalMs >= 380 && diag.totalMs < 2000, `totalMs=${diag.totalMs}`);
});

test('5xx surfaces as the origin status with transport ok', async () => {
  const { json } = await call(init(mock.base + '/fail'));
  assert.equal(json.status, 503);
  assert.equal(json.diag.ok, true);
});

test('timeout: classified, aborted near the deadline, readable JSON-RPC error body', async () => {
  const t0 = Date.now();
  const { status, json } = await call(init(mock.base + '/hang', { timeoutMs: 900 }));
  const elapsed = Date.now() - t0;
  assert.equal(status, 200, 'transport failures still return 200 so the UI can read diagnostics');
  assert.equal(json.status, 0);
  assert.equal(json.diag.ok, false);
  assert.equal(json.diag.errorType, 'timeout');
  assert.match(json.diag.errorDetail, /900ms/);
  assert.ok(elapsed >= 850 && elapsed < 2500, `${elapsed}ms for a 900ms timeout`);
  assert.equal(JSON.parse(json.body).error.code, -32001);
});

test('retries: 3 attempts logged, with backoff between them', async () => {
  const t0 = Date.now();
  const { json } = await call(init(mock.base + '/hang', { timeoutMs: 500, retries: 2 }));
  assert.equal(json.diag.attempts, 3);
  assert.deepEqual(json.diag.attemptLog.map((a) => a.outcome), ['timeout', 'timeout', 'timeout']);
  assert.ok(Date.now() - t0 >= 1500 + 250 + 500, 'three timeouts plus backoff');
});

test('network failure is classified as network', async () => {
  const { json } = await call(init('http://127.0.0.1:1/mcp'));
  assert.equal(json.diag.errorType, 'network');
});

test('Accept header repaired when missing or partial', async () => {
  for (const headers of [{ 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json', Accept: 'application/json' }]) {
    const { json } = await call(init(mock.url, { headers }));
    assert.equal(json.status, 200);
  }
});

test('content-type defaulted for POST when absent', async () => {
  const { json } = await call(init(mock.url, { headers: { Accept: ACCEPT } }));
  assert.equal(json.status, 200);
});

test('hop-by-hop headers are not forwarded', async () => {
  mock.calls.length = 0;
  await call(init(mock.url, { headers: { Accept: ACCEPT, Origin: 'https://evil.example', Referer: 'https://x', 'X-Keep': '1' } }));
  const h = mock.calls.at(-1).headers;
  assert.equal(h.origin, undefined);
  assert.equal(h.referer, undefined);
  assert.equal(h['x-keep'], '1');
});

test('JSON-RPC error inside HTTP 200 is passed through untouched', async () => {
  const sid = (await call(init(mock.url))).json.headers['mcp-session-id'];
  const { json } = await call({
    url: mock.url, headers: { Accept: ACCEPT, 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 2, params: { name: 'get_api_details', arguments: {} } }),
  });
  assert.equal(json.status, 200);
  assert.equal(JSON.parse(json.body).error.code, -32602);
});

test('allowlist: blocked host → 403, allowed host passes', async () => {
  const blocked = await call(init('https://example.com/mcp'), { allowTargets: ['developer.hsbc.com'] });
  assert.equal(blocked.status, 403);
  assert.deepEqual(blocked.json.allowed, ['developer.hsbc.com']);
  const ok = await call(init(mock.url), { allowedOrigins: ['127.0.0.1'], allowTargets: undefined });   // the old option name still works
  assert.equal(ok.json.status, 200);
});

test('bad input: missing url and invalid url → 400', async () => {
  assert.equal((await call({})).status, 400);
  assert.equal((await call({ url: 'not a url' })).status, 400);
});

test('colo reported in diagnostics', async () => {
  const { json } = await call(init(mock.url), { colo: 'LHR' });
  assert.equal(json.diag.colo, 'LHR');
});

test('helpers: parseAllowedOrigins and clampInt', () => {
  assert.deepEqual(parseAllowedOrigins(' a.com, b.com ,, '), ['a.com', 'b.com']);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.equal(clampInt('99999999', 500, 120000, 15000), 120000);
  assert.equal(clampInt('abc', 0, 3, 0), 0);
  assert.equal(clampInt(-5, 0, 3, 0), 0);
});

test('purpose "oauth": no MCP Accept or Content-Type repair; defaults to Accept: application/json', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push(init.headers); return new Response('{}', { status: 200 }); };
  await proxyMcp({ url: 'https://as.example/.well-known/oauth-authorization-server', method: 'GET', purpose: 'oauth' }, { fetch: fakeFetch });
  assert.equal(seen[0].get('accept'), 'application/json');
  await proxyMcp({ url: 'https://as.example/token', method: 'POST', purpose: 'oauth', body: 'a=b',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, { fetch: fakeFetch });
  assert.equal(seen[1].get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(seen[1].get('accept'), 'application/json');
  await proxyMcp({ url: 'https://mcp.example/mcp', method: 'POST', body: '{}' }, { fetch: fakeFetch });
  assert.equal(seen[2].get('accept'), 'application/json, text/event-stream', 'MCP requests are still repaired');
});

// ── Target policy (SEC-PROXY) ──

/** A tiny origin on 127.0.0.1 that records every request and answers via handler(req, res, body) */
async function origin(handler) {
  const http = await import('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const ok200 = (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); };
const redirectTo = (status, location) => (req, res) => { res.writeHead(status, { Location: location }); res.end(); };

test('AC-SEC-PROXY-01: a redirect to a target outside the policy is refused and never fetched', async () => {
  const inside = await origin(ok200);
  const first = await origin(redirectTo(307, inside.base + '/mcp'));
  try {
    const r = await proxyMcp(init(first.base + '/mcp', { retries: 2 }), { fetch, allowTargets: [first.base] });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /^Redirect refused/);
    assert.equal(r.json.redirects[0].location, inside.base + '/mcp');
    assert.equal(inside.seen.length, 0, 'the unlisted origin was never contacted');
    assert.equal(first.seen.length, 1, 'a refusal is not retried');
  } finally { await inside.close(); await first.close(); }
});

test('AC-SEC-PROXY-02: redirects inside the policy are followed, without credentials across origins', async () => {
  const final = await origin(ok200);
  const sameOriginHop = await origin((req, res) => {
    if (req.url === '/mcp') return redirectTo(308, '/moved')(req, res);
    return redirectTo(307, final.base + '/mcp')(req, res);
  });
  try {
    const r = await proxyMcp(init(sameOriginHop.base + '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: ACCEPT, Authorization: 'Bearer secret', Cookie: 'sid=1', 'Mcp-Session-Id': 's1', 'MCP-Protocol-Version': '2026-07-28' },
    }), { fetch, allowTargets: [sameOriginHop.base, final.base] });
    assert.equal(r.json.status, 200);
    assert.deepEqual(r.json.diag.redirects.map((h) => h.status), [308, 307]);
    assert.equal(sameOriginHop.seen[1].headers.authorization, 'Bearer secret', 'a same-origin hop keeps credentials');
    const h = final.seen[0].headers;
    assert.equal(h.authorization, undefined);
    assert.equal(h.cookie, undefined);
    assert.equal(h['mcp-session-id'], undefined);
    assert.equal(h['mcp-protocol-version'], '2026-07-28', 'protocol headers survive');
    assert.equal(final.seen[0].method, 'POST', '307 keeps the method');
    assert.match(final.seen[0].body, /initialize/, '307 keeps the body');
  } finally { await final.close(); await sameOriginHop.close(); }

  for (const status of [303, 302]) {
    const target = await origin(ok200);
    const hop = await origin(redirectTo(status, target.base + '/x'));
    try {
      await proxyMcp(init(hop.base + '/mcp'), { fetch, allowTargets: [hop.base, target.base] });
      assert.equal(target.seen[0].method, 'GET', status + ' after a POST continues as a GET');
      assert.equal(target.seen[0].body, '');
      assert.equal(target.seen[0].headers['content-type'], undefined);
    } finally { await target.close(); await hop.close(); }
  }
});

test('AC-SEC-PROXY-03: a redirect loop stops after five hops', async () => {
  const loop = await origin(redirectTo(302, '/again'));
  try {
    const r = await proxyMcp(init(loop.base + '/mcp'), { fetch, allowTargets: [loop.base] });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /Too many redirects/);
    assert.equal(loop.seen.length, 6, 'the first request plus five redirects');
  } finally { await loop.close(); }
});

test('AC-SEC-PROXY-04: special-purpose addresses are refused unless listed, in every spelling', async () => {
  let fetched = 0;
  const counting = async () => { fetched++; return new Response('{}', { status: 200 }); };
  const refusedTargets = [
    'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://192.168.1.1/',
    'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[::]/', 'http://[fe80::1]/', 'http://[fd00::1]/',
    'http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://127.1/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a00:5]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/',
    'http://localhost:8788/', 'http://api.localhost/', 'http://224.0.0.1/', 'http://[2001:db8::1]/',
  ];
  for (const url of refusedTargets) {
    const r = await proxyMcp({ url, method: 'GET' }, { fetch: counting });
    assert.equal(r.status, 403, url);
    assert.match(r.json.hint, /MCP_TESTER_ALLOWED_TARGETS/, url);
  }
  assert.equal(fetched, 0, 'nothing was fetched');

  for (const url of ['https://developer.hsbc.com/mcp', 'http://8.8.8.8/', 'http://[2606:4700::1111]/', 'http://[2002:808:808::]/']) {
    assert.equal((await proxyMcp({ url, method: 'GET' }, { fetch: counting })).status, 200, url + ' is public');
  }
  assert.equal((await proxyMcp({ url: 'http://10.0.0.5:8080/mcp', method: 'GET' }, { fetch: counting, allowTargets: ['http://10.0.0.5:8080'] })).status, 200, 'a listed exact origin');
  assert.equal((await proxyMcp({ url: 'http://10.0.0.5:9999/mcp', method: 'GET' }, { fetch: counting, allowTargets: ['http://10.0.0.5:8080'] })).status, 403, 'another port of it is not');
  assert.equal((await proxyMcp({ url: 'http://localhost:1/', method: 'GET' }, { fetch: counting, allowTargets: ['localhost'] })).status, 200, 'a listed host');
  assert.equal((await proxyMcp({ url: 'http://10.0.0.5/', method: 'GET' }, { fetch: counting, allowTargets: ['*'] })).status, 403, '* means public only');
});

test('AC-SEC-PROXY-05: only http and https targets', async () => {
  let fetched = 0;
  const counting = async () => { fetched++; return new Response('{}'); };
  for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'data:text/plain,hi', 'javascript:alert(1)', 'https://user:pw@example.com/']) {
    assert.equal((await proxyMcp({ url, method: 'GET' }, { fetch: counting, allowTargets: ['*'] })).status, 403, url);
  }
  assert.equal(fetched, 0);
});
