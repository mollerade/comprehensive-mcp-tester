/**
 * POST /compliance on both hosts (#13): the check runs on the host, through the
 * same guard, target policy and proxy as /proxy, and stops when the caller goes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../scripts/build.mjs';
import { createServer } from '../../src/hosts/node-server.js';
import { startMock } from '../fixtures/mock-mcp-server.mjs';

let mock, server, base;
before(async () => {
  mock = await startMock({ port: 0 });
  server = createServer({ allowedTargets: '127.0.0.1', allowedHosts: '', token: '' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  await mock.close();
});

const check = (payload, headers = {}, signal) => fetch(base + '/compliance', {
  method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json', ...headers }, signal,
});

test('AC-SPEC-REPORT-01: POST /compliance grades a server and returns the report and its Markdown', async () => {
  const res = await check({ url: mock.url });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.report.verdict, 'pass');
  assert.equal(body.summary.era, 'legacy');
  assert.match(body.markdown, /^# MCP compliance: /);
  assert.equal(body.exchanges, undefined, 'the raw exchanges stay on the host');

  const bad = await (await check({ url: mock.base + '/scenario/id-mismatch/mcp' })).json();
  const r = bad.report.results.find((x) => x.id === 'MCP-RPC-002');
  assert.equal(r.status, 'fail');
  assert.ok(r.evidence, 'findings carry their evidence');

  // The Worker bundle, as built, answers the same way
  const file = join(mkdtempSync(join(tmpdir(), 'mcpt-')), 'worker.mjs');
  writeFileSync(file, build({ write: false }).mod);
  const worker = (await import(pathToFileURL(file).href)).default;
  const wres = await worker.fetch(new Request('https://w.dev/compliance', { method: 'POST', body: JSON.stringify({ url: mock.url }) }),
    { MCP_TESTER_ALLOWED_TARGETS: '127.0.0.1' });
  assert.equal(wres.status, 200);
  assert.equal((await wres.json()).report.verdict, 'pass');
  const closed = await worker.fetch(new Request('https://w.dev/compliance', { method: 'POST', body: JSON.stringify({ url: mock.url }) }), {});
  assert.equal(closed.status, 403, 'the Worker is closed until targets are configured');
});

test('AC-SPEC-REPORT-02: /compliance is guarded like /proxy', async () => {
  assert.equal((await check({ url: mock.url }, { Origin: 'https://evil.example' })).status, 403, 'foreign Origin');
  const refused = await check({ url: mock.url.replace('127.0.0.1', 'localhost') });
  assert.equal(refused.status, 403, 'an unlisted loopback target is refused before any probe');
  assert.match((await refused.json()).hint, /MCP_TESTER_ALLOWED_TARGETS/);
  assert.equal((await check({})).status, 400);
  const plain = await fetch(base + '/compliance', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(plain.status, 415);
});

test('AC-SPEC-REPORT-03: a cancelled check stops sending probes', async () => {
  const before = mock.calls.length;
  const controller = new AbortController();
  const pending = check({ url: mock.url + '?delay=300' }, {}, controller.signal).catch((e) => e);
  await new Promise((r) => setTimeout(r, 450));
  controller.abort();
  assert.equal((await pending).name, 'AbortError');
  const atCancel = mock.calls.length;
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(mock.calls.length - atCancel <= 1, 'at most the probe in flight finishes after the cancel');
  assert.ok(mock.calls.length - before < 6, 'far fewer probes than a full run');
});
