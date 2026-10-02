/**
 * Compliance rules (#10 protocol, #11 features), graded end to end: the collector
 * probes the mock server through the real proxy core, the engine grades the
 * recording. Every rule has a mock scenario that breaks it, and correct servers
 * pass every rule that applies to them.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from '../fixtures/mock-mcp-server.mjs';
import { collectCompliance, parseEventStream } from '../../src/core/compliance/collect.js';
import { runCompliance } from '../../src/core/compliance/engine.js';
import { COMPLIANCE_CATALOGUE } from '../../src/core/compliance/catalogue.js';
import { schemaProblems } from '../../src/core/compliance/rules/json-schema.js';
import { proxySend, markdownReport } from '../../scripts/compliance.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let mock;
before(async () => { mock = await startMock({ port: 0 }); });
after(async () => { await mock.close(); });

const send = (url) => proxySend([new URL(url).origin], fetch);
async function grade(path, extra = {}) {
  const url = mock.base + path;
  const ctx = await collectCompliance({ url, send: send(url), ...extra });
  return { ctx, report: runCompliance(COMPLIANCE_CATALOGUE, ctx) };
}
/** "MCP-X-001:fail" for every rule that did not pass, skip or not apply */
const flagged = (report) => report.results.filter((r) => ['fail', 'warn', 'error'].includes(r.status)).map((r) => r.id + ':' + r.status).sort();
const scenario = (name) => '/scenario/' + name + '/mcp';

// Each rule, the scenario that breaks it, and every rule that scenario trips
const PROTOCOL_VIOLATIONS = [
  ['MCP-RPC-001', 'wrong-jsonrpc-version', ['MCP-RPC-001:fail']],
  ['MCP-RPC-002', 'id-mismatch', ['MCP-RPC-002:fail']],
  ['MCP-RPC-003', 'result-and-error', ['MCP-RPC-003:fail']],
  ['MCP-RPC-004', 'unknown-method-result', ['MCP-RPC-004:fail']],
  ['MCP-HTTP-001', 'wrong-content-type', ['MCP-HTTP-001:fail']],
  ['MCP-HTTP-002', 'notification-200-body', ['MCP-HTTP-002:fail']],
  ['MCP-HTTP-003', 'unknown-method-200', ['MCP-HTTP-003:fail']],
  ['MCP-HTTP-004', 'header-mismatch-ignored', ['MCP-HTTP-004:fail']],
  ['MCP-SESS-001', 'session-ignored', ['MCP-SESS-001:warn', 'MCP-SESS-002:fail']],
  ['MCP-SESS-002', 'session-ignored', ['MCP-SESS-001:warn', 'MCP-SESS-002:fail']],
  ['MCP-LIFE-001', 'init-missing-serverinfo', ['MCP-LIFE-001:fail']],
  ['MCP-LIFE-002', 'discover-malformed', ['MCP-LIFE-002:fail']],
  ['MCP-VER-002', 'bogus-version-accepted', ['MCP-VER-002:fail']],
  ['MCP-RESULT-001', 'no-result-type', ['MCP-RESULT-001:fail']],
  ['MCP-RESULT-002', 'no-cache-hints', ['MCP-RESULT-002:warn']],
  ['MCP-META-001', 'no-server-info', ['MCP-META-001:warn']],
];
const FEATURE_VIOLATIONS = [
  ['MCP-CAP-001', 'capability-list-fails', ['MCP-CAP-001:fail']],
  ['MCP-TOOL-001', 'malformed-tool', ['MCP-TOOL-001:fail']],
  ['MCP-TOOL-002', 'duplicate-tool-names', ['MCP-TOOL-002:warn']],
  ['MCP-TOOL-003', 'bad-input-schema', ['MCP-TOOL-001:fail', 'MCP-TOOL-003:fail']],   // its type is not "object" either
  ['MCP-TOOL-004', 'bad-mcp-header', ['MCP-TOOL-004:fail']],
  ['MCP-TOOL-005', 'shuffled-tools', ['MCP-TOOL-005:warn']],
  ['MCP-RES-001', 'bad-resource', ['MCP-RES-001:fail']],
  ['MCP-PROMPT-001', 'bad-prompt', ['MCP-PROMPT-001:fail']],
  ['MCP-PAGE-001', 'cursor-loop', ['MCP-PAGE-001:fail', 'MCP-TOOL-002:warn']],   // the repeated page repeats tool names
];

async function assertViolations(table) {
  for (const [rule, name, expected] of table) {
    const { report } = await grade(scenario(name));
    assert.deepEqual(flagged(report), expected.slice().sort(), rule + ' on ' + name);
    const r = report.results.find((x) => x.id === rule);
    assert.ok(r.message && r.message.length > 10, rule + ' explains itself: ' + r.message);
  }
}

test('AC-SPEC-RPC-01: correct servers pass every protocol and feature rule', async () => {
  for (const path of ['/mcp', '/modern', '/dual', scenario('paged')]) {
    const { report } = await grade(path);
    assert.deepEqual(flagged(report), [], path);
    assert.equal(report.verdict, 'pass', path);
    assert.equal(report.bestEffort, false, path);
  }
  const paged = (await grade(scenario('paged'))).report.results.find((r) => r.id === 'MCP-PAGE-001');
  assert.equal(paged.status, 'pass', 'paging is graded when the server pages');
});

test('AC-SPEC-RPC-02: each JSON-RPC, transport, session and lifecycle rule is broken by its scenario', async () => {
  await assertViolations(PROTOCOL_VIOLATIONS);
});

test('AC-SPEC-RPC-03: the probes follow the server\'s era and stay MCP-shaped', async () => {
  const legacy = await grade('/mcp');
  assert.equal(legacy.ctx.era, 'legacy');
  assert.equal(legacy.ctx.claimedVersion, '2025-03-26', 'the version the server chose in initialize');
  const modern = await grade('/modern');
  assert.equal(modern.ctx.era, 'modern');
  assert.equal(modern.ctx.claimedVersion, '2026-07-28');
  const methods = new Set([...legacy.ctx.exchanges, ...modern.ctx.exchanges].map((e) => e.method));
  for (const m of ['tools/call', 'resources/read', 'prompts/get']) assert.equal(methods.has(m), false, 'never sends ' + m);
  assert.ok(legacy.ctx.exchanges.some((e) => e.label === 'unknown session'), 'session probes run in the session era');
  assert.ok(modern.ctx.exchanges.some((e) => e.label === 'unsupported version'), 'version probes run in the stateless era');
});

test('AC-SPEC-RPC-04: a server that is unreachable or refuses the handshake is not graded', async () => {
  const ctx = await collectCompliance({ url: 'http://127.0.0.1:1/mcp', send: send('http://127.0.0.1:1/mcp') });
  assert.equal(ctx.era, null);
  assert.match(ctx.handshakeError, /server\/discover: .*(ECONNREFUSED|fetch failed|connect)/i);
  const unreachable = runCompliance(COMPLIANCE_CATALOGUE, ctx);
  assert.deepEqual(unreachable.results.filter((r) => ['fail', 'error'].includes(r.status)), []);

  // /secure answers 401 until signed in: both handshakes are refused, so nothing is graded as broken
  const refused = await grade('/secure');
  assert.equal(refused.ctx.era, null);
  assert.match(refused.ctx.handshakeError, /server\/discover: HTTP 401.*initialize: HTTP 401/);
  assert.deepEqual(refused.report.results.filter((r) => ['fail', 'error'].includes(r.status)), []);
  assert.match(markdownReport('x', refused.ctx, refused.report), /No handshake succeeded.*--header "Authorization: Bearer/);
  // ...and with a token it is graded like any other server
  const token = 'at-test';
  mock.oauth.tokens.set(token, { resource: mock.base + '/secure', scope: 'mcp:read' });
  const signedIn = await grade('/secure', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(signedIn.ctx.era, 'legacy');
  assert.equal(signedIn.report.verdict, 'pass');
});

test('AC-SPEC-RPC-05: extra headers reach the server and are never recorded', async () => {
  const before = mock.calls.length;
  const { ctx } = await grade('/mcp', { headers: { 'x-api-key': 'k-secret' } });
  assert.ok(mock.calls.slice(before).every((c) => c.headers['x-api-key'] === 'k-secret'));
  assert.equal(JSON.stringify(ctx).includes('k-secret'), false);
});

/** The CLI as a child process; async, because the mock it talks to runs in this process */
function cli(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/compliance.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}

test('AC-SPEC-RPC-06: npm run compliance prints the report and fails on a failing server', async () => {
  const ok = await cli(mock.base + '/mcp');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Verdict: \*\*pass\*\*/);
  const bad = await cli(mock.base + scenario('id-mismatch'), '--json');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).verdict, 'fail');
  assert.equal((await cli('--nope')).status, 2, 'usage error');
  assert.equal((await cli('http://127.0.0.1:1/mcp')).status, 1, 'no answer is a failure');
});

test('AC-SPEC-TOOLS-01: each capability, tools, resources, prompts and paging rule is broken by its scenario', async () => {
  await assertViolations(FEATURE_VIOLATIONS);
});

test('AC-SPEC-TOOLS-02: every rule in the catalogue has a scenario that breaks it', () => {
  const covered = new Set([...PROTOCOL_VIOLATIONS, ...FEATURE_VIOLATIONS].map((v) => v[0]));
  for (const r of COMPLIANCE_CATALOGUE) {
    if (r.id === 'MCP-VER-001') continue;   // graded from the claimed version alone (AC-SPEC-ENGINE-03)
    assert.ok(covered.has(r.id), r.id + ' has no violation scenario');
  }
});

test('AC-SPEC-TOOLS-03: the schema check knows JSON Schema 2020-12 structure and resolves local $refs', () => {
  assert.deepEqual(schemaProblems({ type: 'object', properties: { a: { $ref: '#/$defs/a' }, b: { type: ['string', 'null'] } }, $defs: { a: { type: 'integer' } }, required: ['a'] }), []);
  assert.deepEqual(schemaProblems(true), []);
  assert.deepEqual(schemaProblems({ $defs: { x: { $anchor: 'x' } }, properties: { y: { $ref: '#x' } } }), []);
  const problems = schemaProblems({ type: 'map', required: 'a', properties: { r: { $ref: '#/$defs/missing' }, s: 5, t: { $ref: 'https://example.com/s.json' } }, anyOf: [] });
  const text = problems.join('\n');
  for (const want of ['type "map"', 'required must be a list', '#/properties/r: $ref "#/$defs/missing" does not resolve',
                      '#/properties/s: a schema must be', 'points outside the tool definition', '#/anyOf: must be a non-empty list']) {
    assert.ok(text.includes(want), 'missing: ' + want + '\n' + text);
  }
});

test('AC-SPEC-TOOLS-04: event-stream responses and the Markdown report', async () => {
  assert.deepEqual(parseEventStream('event: message\ndata: {"a":1}\n\ndata: {"b":\ndata: 2}\n\n'), [{ a: 1 }, { b: 2 }]);
  const { ctx, report } = await grade(scenario('id-mismatch'));
  const md = markdownReport(mock.base + scenario('id-mismatch'), ctx, report);
  assert.match(md, /Verdict: \*\*fail\*\*/);
  assert.match(md, /\| FAIL \| \[MCP-RPC-002\]\(https:\/\/modelcontextprotocol\.io\//);
  assert.equal(md.includes('| n/a |'), false, 'rules that do not apply are left out');
});
