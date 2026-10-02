/**
 * The mock MCP server's scenario registry: discovery, routing, the original
 * paths as aliases, the parallel-safe helper, the latency knob, and that each
 * violation scenario breaks exactly the rule it names.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startMock, MODERN_VERSION } from './fixtures/mock-mcp-server.mjs';

const ACCEPT = 'application/json, text/event-stream';
const META = 'io.modelcontextprotocol/';
let mock;
before(async () => { mock = await startMock({ port: 0 }); });
after(() => mock.close());

async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: ACCEPT, ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

const init = (id = 1) => ({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } });

/** initialize, then return headers carrying the session */
async function session(url) {
  const r = await post(url, init());
  assert.equal(r.status, 200, r.text);
  return { 'mcp-session-id': r.headers.get('mcp-session-id') };
}

/** A well-formed 2026-07-28 request with its mirrored headers */
function modern(method, id = 1) {
  const body = { jsonrpc: '2.0', id, method, params: { _meta: { [META + 'protocolVersion']: MODERN_VERSION, [META + 'clientInfo']: { name: 't', version: '0' }, [META + 'clientCapabilities']: {} } } };
  return [body, { 'MCP-Protocol-Version': MODERN_VERSION, 'Mcp-Method': method }];
}

const scenarioUrl = (name) => mock.base + '/scenario/' + name + '/mcp';

const ORIGINAL = ['/mcp', '/slow', '/hang', '/fail', '/stream', '/modern', '/dual', '/secure', '/secure-nohint', '/secure-mixup'];

test('AC-QA-MOCK-01: scenarios are discoverable', async () => {
  const res = await fetch(mock.base + '/__scenarios');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const { scenarios } = await res.json();
  for (const s of scenarios) {
    assert.equal(typeof s.name, 'string');
    assert.ok(s.description, s.name + ' has no description');
    assert.ok(['legacy', 'modern', 'dual'].includes(s.protocol), s.name + ': ' + s.protocol);
  }
  const paths = scenarios.flatMap((s) => s.paths);
  for (const p of ORIGINAL) assert.ok(paths.includes(p), 'not listed: ' + p);
  for (const v of ['wrong-jsonrpc-version', 'id-mismatch', 'unknown-method-200', 'notification-200-body', 'session-ignored', 'bad-input-schema', 'as-no-s256']) {
    assert.ok(scenarios.some((s) => s.name === v), 'missing violation scenario: ' + v);
  }
});

test('AC-QA-MOCK-02: existing paths are unchanged', async () => {
  // Each original path, and its /scenario/<name>/mcp form, answers as documented
  for (const url of [mock.url, scenarioUrl('mcp')]) {
    const h = await session(url);
    assert.ok(h['mcp-session-id']);
    assert.equal((await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status, 400, 'session must be required');
    assert.equal((await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, h)).json.result.tools.length, 3);
  }
  for (const url of [mock.base + '/fail', scenarioUrl('fail')]) assert.equal((await post(url, init())).status, 503);
  for (const url of [mock.base + '/secure', scenarioUrl('secure')]) {
    const r = await post(url, init());
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /resource_metadata=/);
  }
  assert.doesNotMatch((await post(mock.base + '/secure-nohint', init())).headers.get('www-authenticate'), /resource_metadata=/);

  const [discover, dh] = modern('server/discover');
  for (const p of ['/modern', '/dual']) assert.equal((await post(mock.base + p, discover, dh)).json.result.resultType, 'complete');
  assert.equal((await post(mock.base + '/modern', init())).status, 400);

  const t0 = Date.now();
  await post(mock.base + '/slow', init());
  assert.ok(Date.now() - t0 >= 380, '/slow answered in ' + (Date.now() - t0) + 'ms');

  const sh = await session(mock.base + '/stream');
  const call = await post(mock.base + '/stream', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_payment_apis', arguments: {} } }, sh);
  assert.match(call.headers.get('content-type'), /text\/event-stream/);

  await assert.rejects(fetch(mock.base + '/hang', { method: 'POST', headers: { Accept: ACCEPT }, body: '{}', signal: AbortSignal.timeout(300) }));
});

test('AC-QA-MOCK-03: parallel-safe helper', async () => {
  const [a, b] = await Promise.all([startMock({ port: 0 }), startMock({ port: 0 })]);
  const portOf = (m) => Number(new URL(m.url).port);
  assert.notEqual(portOf(a), portOf(b));
  const [ra, rb] = await Promise.all([post(a.url, init()), post(b.url, init())]);
  assert.ok(ra.headers.get('mcp-session-id'));
  assert.notEqual(ra.headers.get('mcp-session-id'), rb.headers.get('mcp-session-id'));

  await Promise.all([a.close(), b.close()]);
  for (const port of [portOf(a), portOf(b)]) {
    const s = net.createServer();
    await new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, '127.0.0.1', resolve); });
    await new Promise((r) => s.close(r));
  }
});

test('AC-QA-MOCK-04: violation scenario is deterministic', async () => {
  const url = scenarioUrl('wrong-jsonrpc-version');
  const h = await session(url);
  for (let i = 0; i < 20; i++) {
    const r = await post(url, { jsonrpc: '2.0', id: 10 + i, method: 'tools/list' }, h);
    assert.equal(r.status, 200);
    assert.equal(r.json.jsonrpc, '1.0');
    assert.equal(r.json.id, 10 + i);
    assert.equal(r.json.result.tools.length, 3);
  }
});

test('AC-QA-MOCK-05: unknown scenario is a clear error', async () => {
  const r = await post(scenarioUrl('does-not-exist'), init());
  assert.equal(r.status, 404);
  assert.equal(r.text, 'unknown scenario: does-not-exist');
});

test('AC-QA-MOCK-06: latency knob', async () => {
  const [discover, dh] = modern('server/discover');
  for (const [url, body, headers] of [[mock.url + '?delay=300', init(), {}], [scenarioUrl('modern') + '?delay=300', discover, dh]]) {
    const t0 = performance.now();
    const r = await post(url, body, headers);
    assert.equal(r.status, 200, r.text);
    assert.ok(performance.now() - t0 >= 300, url + ' answered in ' + Math.round(performance.now() - t0) + 'ms');
  }
});

test('violation id-mismatch: response ids differ from request ids', async () => {
  const url = scenarioUrl('id-mismatch');
  const r = await post(url, init(7));
  assert.equal(r.status, 200);
  assert.notEqual(r.json.id, 7);
  assert.ok(r.json.result.serverInfo);
});

test('violation unknown-method-200: unknown method gets HTTP 200, still -32601', async () => {
  const [body, h] = modern('no/such-method');
  const r = await post(scenarioUrl('unknown-method-200'), body, h);
  assert.equal(r.status, 200);
  assert.equal(r.json.error.code, -32601);
  assert.equal((await post(scenarioUrl('modern'), body, h)).status, 404, 'the compliant server answers 404');
});

test('violation notification-200-body: a notification gets 200 with a body', async () => {
  const url = scenarioUrl('notification-200-body');
  const r = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, await session(url));
  assert.equal(r.status, 200);
  assert.ok(r.json && r.json.jsonrpc);
});

test('violation session-ignored: requests without a valid session are served', async () => {
  const url = scenarioUrl('session-ignored');
  assert.ok((await post(url, init())).headers.get('mcp-session-id'), 'still issues a session id');
  for (const h of [{}, { 'mcp-session-id': 'not-a-session' }]) {
    assert.equal((await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, h)).status, 200);
  }
});

test('violation bad-input-schema: one listed tool has an invalid inputSchema', async () => {
  const url = scenarioUrl('bad-input-schema');
  const { json } = await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, await session(url));
  const bad = json.result.tools.find((t) => t.name === 'bad_schema_tool');
  assert.equal(json.result.tools.length, 4);
  assert.equal(bad.inputSchema.type, 'objekt');
});

test('violation as-no-s256: the authorization server does not offer PKCE S256', async () => {
  const r = await post(scenarioUrl('as-no-s256'), init());
  assert.equal(r.status, 401);
  const prmUrl = /resource_metadata="([^"]+)"/.exec(r.headers.get('www-authenticate'))[1];
  const prm = await (await fetch(prmUrl)).json();
  assert.equal(prm.authorization_servers[0], mock.base + '/as-no-s256');
  const as = await (await fetch(mock.base + '/.well-known/oauth-authorization-server/as-no-s256')).json();
  assert.equal(as.issuer, mock.base + '/as-no-s256');
  assert.deepEqual(as.code_challenge_methods_supported, ['plain']);
});
