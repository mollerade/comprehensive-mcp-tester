/**
 * Traceability checker (scripts/check-traceability.mjs), run as a real process
 * against throwaway fixture trees, plus once against this repository.
 *
 * Fixture test files are generated at run time with `testLine()`, so the demo
 * AC IDs they carry never appear as test titles in this file.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-traceability.mjs');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const testLine = (id, title) => `test(${JSON.stringify(id + ': ' + title)}, () => {});\n`;
const scenario = (id, extraTags = '') => `  @${id} @suite:demo ${extraTags}\n  Scenario: ${id}\n    Given x\n    When y\n    Then z\n\n`;

/** A fixture checkout: { 'docs/acceptance/v0.10.1/DEMO.feature': '...', ... } plus package.json */
function tree(files, version = '0.10.1') {
  const dir = mkdtempSync(join(tmpdir(), 'trace-'));
  made.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function run(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root=' + root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('AC-QA-TRACE-01: covered AC passes', () => {
  const r = run(ROOT);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^covered: AC-QA-TRACE-01 \(tests\/tooling\/traceability\.test\.js:\d+\)$/m);
});

test('AC-QA-TRACE-02: missing test fails with a precise message', () => {
  const root = tree({ 'docs/acceptance/v0.10.1/DEMO.feature': 'Feature: demo\n\n' + scenario('AC-DEMO-02') });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.err, /^missing: AC-DEMO-02 \(docs\/acceptance\/v0\.10\.1\/DEMO\.feature:3\)$/m);
});

test('AC-QA-TRACE-03: unknown AC ID in a test fails', () => {
  const root = tree({ 'tests/demo.test.js': '\n' + testLine('AC-DEMO-99', 'typo') });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.err, /^unknown: AC-DEMO-99 \(tests\/demo\.test\.js:2\)$/m);
});

test('AC-QA-TRACE-04: duplicate AC IDs are rejected', () => {
  const root = tree({
    'docs/acceptance/v0.10.1/A.feature': 'Feature: a\n\n' + scenario('AC-DEMO-01'),
    'docs/acceptance/v0.10.1/B.feature': 'Feature: b\n\n' + scenario('AC-DEMO-01'),
    'tests/demo.test.mjs': testLine('AC-DEMO-01', 'covered once'),
  });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.err, /^duplicate: AC-DEMO-01 \(docs\/acceptance\/v0\.10\.1\/A\.feature:3, docs\/acceptance\/v0\.10\.1\/B\.feature:3\)$/m);
});

test('AC-QA-TRACE-05: pending ACs only pass until their milestone', () => {
  const files = { 'docs/acceptance/v0.10.2/LATER.feature': 'Feature: later\n\n' + scenario('AC-LATER-01', '@pending') };
  const before = run(tree(files, '0.10.1'));
  assert.equal(before.code, 0, before.err);
  assert.match(before.out, /^pending: AC-LATER-01 /m);

  const reached = run(tree(files, '0.10.2'));
  assert.equal(reached.code, 1);
  assert.match(reached.err, /^pending past milestone: AC-LATER-01 /m);

  // Feature-level @pending applies to every scenario (Gherkin tag inheritance)
  const inherited = run(tree({ 'docs/acceptance/v0.10.2/X.feature': '@pending\nFeature: x\n\n' + scenario('AC-LATER-02') }, '0.10.1'));
  assert.equal(inherited.code, 0, inherited.err);
});

test('AC-QA-TRACE-06: machine-readable output', () => {
  const ids = ['AC-DEMO-01', 'AC-DEMO-02', 'AC-DEMO-03'];
  const root = tree({
    'docs/acceptance/v0.10.1/DEMO.feature': 'Feature: demo\n\n' + [...ids, 'AC-DEMO-04'].map((id) => scenario(id)).join(''),
    'docs/acceptance/v0.10.2/LATER.feature': 'Feature: later\n\n' + scenario('AC-LATER-01', '@pending') + scenario('AC-LATER-02', '@pending'),
    'tests/nested/demo.test.js': ids.map((id) => testLine(id, 'ok')).join(''),
  });
  const r = run(root, '--format=json');
  assert.equal(r.code, 1);
  const report = JSON.parse(r.out);
  assert.deepEqual(
    { covered: report.covered, missing: report.missing, pending: report.pending, unknown: report.unknown },
    { covered: 3, missing: 1, pending: 2, unknown: 0 });
  assert.equal(report.items.length, 6);
  for (const item of report.items) {
    assert.deepEqual(Object.keys(item).sort(), ['feature', 'id', 'status', 'tests']);
    assert.ok(Array.isArray(item.tests));
  }
  assert.deepEqual(report.items.find((i) => i.id === 'AC-DEMO-01').tests, ['tests/nested/demo.test.js:1']);
});

test('AC-QA-TRACE-07: zero dependencies', () => {
  const imports = [...readFileSync(SCRIPT, 'utf8').matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const spec of imports) assert.match(spec, /^node:/, 'non-built-in import: ' + spec);

  // A copy outside the repo has no node_modules anywhere above it
  const isolated = tree({});
  mkdirSync(join(isolated, 'scripts'));
  copyFileSync(SCRIPT, join(isolated, 'scripts', 'check-traceability.mjs'));
  const out = execFileSync(process.execPath, ['scripts/check-traceability.mjs'], { cwd: isolated, encoding: 'utf8' });
  assert.match(out, /0 covered, 0 missing/);
});
