/**
 * Compliance rule engine (src/core/compliance/): catalogue shape, rule selection
 * by claimed version, error isolation, determinism and verdict aggregation.
 * Most tests grade small synthetic catalogues so each property is seen alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCompliance, selectRules, complianceVerdict } from '../../src/core/compliance/engine.js';
import { COMPLIANCE_CATALOGUE } from '../../src/core/compliance/catalogue.js';

const SPEC = 'https://modelcontextprotocol.io/specification/versioning';
const rule = (id, appliesTo, check, extra = {}) =>
  ({ id, title: id, category: 'demo', severity: 'fail', appliesTo, specRef: SPEC, check, ...extra });
const pass = () => ({ ok: true });
const byId = (report) => Object.fromEntries(report.results.map((r) => [r.id, r]));

test('AC-SPEC-ENGINE-01: catalogue is well-formed', () => {
  assert.ok(COMPLIANCE_CATALOGUE.length > 0);
  const ids = COMPLIANCE_CATALOGUE.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate rule id');
  for (const r of COMPLIANCE_CATALOGUE) {
    assert.match(r.id, /^MCP-[A-Z]+-\d{3}$/);
    assert.ok(['fail', 'warn'].includes(r.severity), r.id + ' severity');
    assert.ok(Array.isArray(r.appliesTo) && r.appliesTo.length > 0, r.id + ' appliesTo');
    for (const v of r.appliesTo) assert.match(v, /^\d{4}-\d{2}-\d{2}$/, r.id + ' appliesTo ' + v);
    assert.equal(new URL(r.specRef).protocol, 'https:', r.id + ' specRef');
    assert.ok(r.title && r.category && typeof r.check === 'function', r.id);
  }
});

test('AC-SPEC-ENGINE-02: rules selected by claimed version', () => {
  const calls = [];
  const catalogue = [
    rule('MCP-DEMO-001', ['2026-07-28'], () => { calls.push('modern'); return { ok: true }; }),
    rule('MCP-DEMO-002', ['2025-11-25'], () => { calls.push('legacy'); return { ok: true }; }),
    rule('MCP-DEMO-003', ['2025-11-25', '2026-07-28'], () => { calls.push('both'); return { ok: true }; }),
  ];
  const report = runCompliance(catalogue, { claimedVersion: '2026-07-28' });
  assert.deepEqual(calls, ['modern', 'both']);
  const r = byId(report);
  assert.equal(r['MCP-DEMO-001'].status, 'pass');
  assert.equal(r['MCP-DEMO-002'].status, 'not-applicable');
  assert.equal(r['MCP-DEMO-003'].status, 'pass');
  assert.equal(report.bestEffort, false);
  assert.equal(report.version, '2026-07-28');
});

test('AC-SPEC-ENGINE-03: unknown version is best effort', () => {
  const catalogue = [...COMPLIANCE_CATALOGUE, rule('MCP-DEMO-001', ['2025-11-25'], pass)];
  const report = runCompliance(catalogue, { claimedVersion: '2099-01-01' });
  const r = byId(report);
  assert.equal(r['MCP-VER-001'].status, 'warn');
  assert.match(r['MCP-VER-001'].message, /unknown protocol version/);
  assert.equal(report.bestEffort, true);
  assert.equal(report.version, selectRules(catalogue, '2099-01-01').version);
  assert.equal(report.version, '2026-07-28', 'the newest known rule set runs');
  for (const res of report.results.filter((x) => x.status !== 'not-applicable')) assert.equal(res.bestEffort, true, res.id);
  assert.equal(r['MCP-DEMO-001'].status, 'not-applicable', 'older-only rules do not run');
});

test('AC-SPEC-ENGINE-04: a crashing rule does not stop the run', () => {
  const catalogue = [
    rule('MCP-DEMO-001', ['2026-07-28'], pass),
    rule('MCP-DEMO-002', ['2026-07-28'], () => { throw new Error('boom'); }),
    rule('MCP-DEMO-003', ['2026-07-28'], () => ({ ok: false, message: 'broken' })),
  ];
  const r = byId(runCompliance(catalogue, { claimedVersion: '2026-07-28' }));
  assert.equal(r['MCP-DEMO-002'].status, 'error');
  assert.equal(r['MCP-DEMO-002'].message, 'boom');
  assert.equal(r['MCP-DEMO-001'].status, 'pass');
  assert.equal(r['MCP-DEMO-003'].status, 'fail');
});

test('AC-SPEC-ENGINE-05: deterministic evaluation', () => {
  const exchanges = [{ request: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, status: 200, response: { jsonrpc: '1.0', id: 1, result: { tools: [] } } }];
  const catalogue = [
    ...COMPLIANCE_CATALOGUE,
    rule('MCP-DEMO-001', ['2026-07-28'], (ctx) => {
      const bad = ctx.exchanges.find((e) => e.response.jsonrpc !== '2.0');
      return bad ? { ok: false, message: 'jsonrpc must be "2.0"', evidence: bad } : { ok: true };
    }),
  ];
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => { fetched++; throw new Error('network during evaluation'); };
  try {
    const a = runCompliance(catalogue, { claimedVersion: '2026-07-28', exchanges });
    const b = runCompliance(catalogue, { claimedVersion: '2026-07-28', exchanges });
    assert.deepEqual(a, b);
    assert.equal(byId(a)['MCP-DEMO-001'].status, 'fail');
    assert.deepEqual(byId(a)['MCP-DEMO-001'].evidence, exchanges[0]);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0);
});

test('AC-SPEC-ENGINE-06: warn-severity rules never produce fail', () => {
  const catalogue = [
    rule('MCP-DEMO-001', ['2026-07-28'], () => ({ ok: false, message: 'soft' }), { severity: 'warn' }),
    rule('MCP-DEMO-002', ['2026-07-28'], pass),
  ];
  const report = runCompliance(catalogue, { claimedVersion: '2026-07-28' });
  assert.equal(byId(report)['MCP-DEMO-001'].status, 'warn');
  assert.equal(report.verdict, 'warn');
  assert.equal(report.counts.fail, 0);
});

test('verdict: fail beats warn, an error is never a pass, skipped and n/a are neutral', () => {
  const st = (...s) => s.map((status) => ({ status }));
  assert.equal(complianceVerdict(st('pass', 'warn', 'fail')), 'fail');
  assert.equal(complianceVerdict(st('pass', 'error')), 'warn');
  assert.equal(complianceVerdict(st('pass', 'skipped', 'not-applicable')), 'pass');
});

test('a rule that needs a probe is skipped on a passive recording', () => {
  const catalogue = [rule('MCP-DEMO-001', ['2026-07-28'], pass, { needsProbe: true })];
  assert.equal(runCompliance(catalogue, { claimedVersion: '2026-07-28' }).results[0].status, 'skipped');
  assert.equal(runCompliance(catalogue, { claimedVersion: '2026-07-28', probed: true }).results[0].status, 'pass');
});

test('a known legacy version is graded against its own rules, not best effort', () => {
  const report = runCompliance(COMPLIANCE_CATALOGUE, { claimedVersion: '2025-03-26' });
  assert.equal(report.bestEffort, false);
  assert.equal(byId(report)['MCP-VER-001'].status, 'pass');
  assert.equal(report.verdict, 'pass');
});
