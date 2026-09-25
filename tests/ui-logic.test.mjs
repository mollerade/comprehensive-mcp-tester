/**
 * Pure logic inside the client JS, run in a VM with a minimal DOM stub.
 * Loads the exact script the page ships (assembleJs), so this tests real code.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { assembleJs } from '../src/ui/assemble.js';

function loadClient() {
  const el = () => ({
    value: '', textContent: '', innerHTML: '', hidden: false, style: {}, title: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {}, click() {},
    getBoundingClientRect: () => ({ width: 100, height: 50 }),
  });
  const ctx = {
    document: { getElementById: el, querySelectorAll: () => [], createElement: el, body: el(), documentElement: el() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { innerWidth: 1200, innerHeight: 800 },
    navigator: {},
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, alert() {}, console,
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    fetch: () => new Promise(() => {}),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(assembleJs(), ctx, { filename: 'client.js' });
  return ctx;
}

let c;
beforeEach(() => { c = loadClient(); });

describe('percentile', () => {
  const s10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s100 = Array.from({ length: 100 }, (_, i) => i + 1);
  test('p50 of 1..10 = 5', () => assert.equal(c.percentile(s10, 0.5), 5));
  test('p95 of 1..10 = 10', () => assert.equal(c.percentile(s10, 0.95), 10));
  test('p100 = max', () => assert.equal(c.percentile(s10, 1), 10));
  test('single element', () => assert.equal(c.percentile([42], 0.95), 42));
  test('empty → null', () => assert.equal(c.percentile([], 0.5), null));
  test('p95 of 1..100 = 95', () => assert.equal(c.percentile(s100, 0.95), 95));
  test('p99 of 1..100 = 99', () => assert.equal(c.percentile(s100, 0.99), 99));
});

describe('probe classification', () => {
  beforeEach(() => { c.diag.slowMs = 2000; });
  test('fast success → ok', () => assert.equal(c.probeClass({ ok: true, ms: 100 }), 'ok'));
  test('slow success → slow', () => assert.equal(c.probeClass({ ok: true, ms: 5000 }), 'slow'));
  test('boundary (== slowMs) → ok', () => assert.equal(c.probeClass({ ok: true, ms: 2000 }), 'ok'));
  test('failure → fail', () => assert.equal(c.probeClass({ ok: false, ms: null }), 'fail'));
  test('failure outranks slow', () => assert.equal(c.probeClass({ ok: false, ms: 9000 }), 'fail'));
});

describe('computeStats on a flapping window', () => {
  let st;
  beforeEach(() => {
    c.diag.slowMs = 2000;
    c.diag.probes = [
      { t: 1, ok: true, ms: 100 }, { t: 2, ok: true, ms: 200 }, { t: 3, ok: false, ms: null, errorType: 'timeout' },
      { t: 4, ok: true, ms: 300 }, { t: 5, ok: true, ms: 5000 }, { t: 6, ok: true, ms: 150 },
      { t: 7, ok: true, ms: 250 }, { t: 8, ok: true, ms: 180 },
      { t: 9, ok: false, ms: null, errorType: 'timeout' }, { t: 10, ok: false, ms: null, errorType: 'http5xx' },
    ];
    st = c.computeStats();
  });
  test('total = 10', () => assert.equal(st.total, 10));
  test('ok = 7', () => assert.equal(st.ok, 7));
  test('fail = 3', () => assert.equal(st.fail, 3));
  test('slow = 1', () => assert.equal(st.slow, 1));
  test('uptime = 70%', () => assert.ok(Math.abs(st.uptime - 70) < 1e-9));
  test('ok + fail = total (no double count)', () => assert.equal(st.ok + st.fail, st.total));
  test('slow counted inside ok', () => assert.ok(st.slow <= st.ok));
  test('current streak = 2 (trailing failures)', () => assert.equal(st.curStreak, 2));
  test('max streak = 2', () => assert.equal(st.maxStreak, 2));
  test('errCounts timeout=2, http5xx=1', () => assert.deepEqual({ ...st.errCounts }, { timeout: 2, http5xx: 1 }));
  test('min = 100', () => assert.equal(st.min, 100));
  test('max = 5000', () => assert.equal(st.max, 5000));
  test('failures excluded from latency stats', () => assert.ok(st.p50 !== null && st.p50 < 5000));
});

describe('computeStats edge cases', () => {
  test('empty window → total 0, uptime null', () => {
    c.diag.probes = [];
    const s = c.computeStats();
    assert.equal(s.total, 0); assert.equal(s.uptime, null);
  });
  test('all-failed → uptime 0, no NaN, streak 1', () => {
    c.diag.probes = [{ t: 1, ok: false, ms: null, errorType: 'timeout' }];
    const s = c.computeStats();
    assert.equal(s.uptime, 0); assert.equal(s.p50, null); assert.equal(s.curStreak, 1); assert.equal(s.maxStreak, 1);
  });
  test('all-ok → uptime 100, streak 0', () => {
    c.diag.probes = [{ t: 1, ok: true, ms: 50 }];
    const s = c.computeStats();
    assert.equal(s.uptime, 100); assert.equal(s.curStreak, 0);
  });
});

describe('fmtMs', () => {
  test('null → em dash', () => assert.equal(c.fmtMs(null), '—'));
  test('850 → 850ms', () => assert.equal(c.fmtMs(850), '850ms'));
  test('1500 → 1.50s', () => assert.equal(c.fmtMs(1500), '1.50s'));
  test('45000 → 45.0s', () => assert.equal(c.fmtMs(45000), '45.0s'));
});

describe('suggested requests from a JSON schema', () => {
  const schema = {
    type: 'object', required: ['api_id', 'mode', 'verbose', 'tags'],
    properties: {
      api_id: { type: 'string' },
      mode: { type: 'string', enum: ['summary', 'full'] },
      verbose: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer', default: 10 },
      note: { type: 'string' },
      when: { type: 'string', format: 'date' },
    },
  };
  test('required params are always suggested', () => {
    const a = c.suggestArgs(schema);
    for (const k of ['api_id', 'mode', 'verbose', 'tags']) assert.ok(k in a, k);
  });
  test('enum → first value, boolean → false, array → one sample item', () => {
    const a = c.suggestArgs(schema);
    assert.equal(a.mode, 'summary'); assert.equal(a.verbose, false); assert.deepEqual([...a.tags], ['text']);
  });
  test('optional with a default is suggested; optional without a hint is not', () => {
    const a = c.suggestArgs(schema);
    assert.equal(a.limit, 10);
    assert.ok(!('note' in a));
    assert.ok(!('when' in a));
  });
  test('formats produce plausible values', () => {
    assert.match(c.suggestValue({ type: 'string', format: 'date' }), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(c.suggestValue({ type: 'string', format: 'email' }), 'user@example.com');
    assert.equal(c.suggestValue({ type: 'integer', minimum: 5 }), 5);
  });
  test('nested objects recurse, and recursion is bounded', () => {
    const v = c.suggestValue({ type: 'object', required: ['a'], properties: { a: { type: 'object', required: ['b'], properties: { b: { type: 'string' } } } } });
    assert.equal(v.a.b, 'text');
    const loop = { type: 'object', properties: {} }; loop.properties.self = loop;
    assert.doesNotThrow(() => c.suggestValue(loop));
  });
});

describe('JSON-RPC envelope', () => {
  test('requests get an incrementing numeric id', () => {
    const a = c.buildBody('tools/list', {}), b = c.buildBody('tools/list', {});
    assert.equal(typeof a.id, 'number'); assert.equal(b.id, a.id + 1);
  });
  test('notifications carry no id', () => {
    assert.ok(!('id' in c.buildBody('notifications/initialized', {})));
  });
});
