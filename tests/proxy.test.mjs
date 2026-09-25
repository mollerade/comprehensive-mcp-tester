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
const call = (payload, env = {}) => proxyMcp(payload, { fetch, ...env });

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
  const blocked = await call(init(mock.url), { allowedOrigins: ['developer.hsbc.com'] });
  assert.equal(blocked.status, 403);
  assert.deepEqual(blocked.json.allowed, ['developer.hsbc.com']);
  const ok = await call(init(mock.url), { allowedOrigins: ['127.0.0.1'] });
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
