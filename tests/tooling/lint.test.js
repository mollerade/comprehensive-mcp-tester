/**
 * The lint gate (#43): CI runs it at zero findings, the client stays ES5 and
 * module-free, and the complexity baseline can only shrink. The ESLint-backed
 * tests need `npm ci --prefix tools/lint`; they skip without it locally and
 * fail without it in CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, declaredName, measured } from '../../tools/lint/run.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const installed = existsSync(join(ROOT, 'tools/lint/node_modules/eslint'));
if (!installed && process.env.CI === 'true') throw new Error('the lint toolchain is required when CI=true: run `npm ci --prefix tools/lint`');
const needsEslint = installed ? false : 'ESLint not installed: run `npm ci --prefix tools/lint`';

const file = (rel, messages) => ({ filePath: join(ROOT, rel), messages });
const source = () => 'function slow(a) {\n  return a;\n}\n';
const tooComplex = (value) => ({ ruleId: 'complexity', severity: 2, line: 1, column: 1, message: `Function 'slow' has a complexity of ${value}. Maximum allowed is 10.` });

test('AC-QA-LINT-01: lint runs in CI at zero warnings', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /run: npm ci --prefix tools\/lint/);
  assert.match(ci, /run: npm run lint\b/);
  const warning = { ruleId: 'no-unused-vars', severity: 1, line: 3, column: 5, message: "'x' is defined but never used." };
  const { plain } = judge([file('src/core/x.js', [warning])], {}, source);
  assert.equal(plain.length, 1, 'a warning must fail the gate like an error');
});

test('AC-QA-LINT-02: client JS stays ES5-style and module-free', { skip: needsEslint }, async () => {
  const { loadEslint } = await import('../../tools/lint/run.mjs');
  const eslint = await loadEslint();
  const lint = async (code) => (await eslint.lintText(code, { filePath: join(ROOT, 'src/ui/js/example.js') }))[0].messages;
  for (const code of ['let x = 1;\n', 'const x = 1;\n', "import x from './x.js';\n", 'export var x = 1;\n']) {
    const messages = await lint(code);
    assert.ok(messages.some((m) => m.fatal), `${code.trim()} was accepted in src/ui/js`);
  }
  assert.deepEqual(await lint('var x = 1;\nfunction f() { return x; }\n'), [], 'ES5 is accepted');
});

test('the complexity baseline only shrinks', () => {
  const baseline = { 'src/core/x.js': { complexity: { slow: 14 } } };
  const run = (value) => judge([file('src/core/x.js', value ? [tooComplex(value)] : [])], baseline, source);
  assert.deepEqual(run(14).regressed, [], 'the baselined value passes');
  assert.match(run(15).regressed[0], /slow is 15, worse than its baseline 14/);
  assert.match(run(12).improved[0], /slow 14 -> 12/, 'an improvement must be recorded');
  assert.match(run(null).improved[0], /slow 14 -> within the ceiling/);
  const other = judge([file('src/core/y.js', [tooComplex(11)])], baseline, source);
  assert.match(other.regressed[0], /not in the baseline \(new offender\)/);
});

test('offenders are keyed by name, whatever the rule reports', () => {
  assert.equal(declaredName('export async function proxyMcp(payload, env) {'), 'proxyMcp');
  assert.equal(declaredName('const route = async (state, req) => {'), 'route');
  assert.equal(declaredName('  handler: function (ctx) {'), 'handler');
  assert.equal(declaredName('  renderTab() {'), 'renderTab');
  assert.equal(declaredName('  }).then(function(res) {'), null);
  assert.equal(measured("Function 'f' has a complexity of 24. Maximum allowed is 10."), 24);
  assert.equal(measured('Refactor this function to reduce its Cognitive Complexity from 27 to the 15 allowed.'), 27);
  assert.equal(measured("Function 'f' has too many lines (83). Maximum allowed is 60."), 83);
});

test('the repository passes the lint gate', { skip: needsEslint }, () => {
  const r = spawnSync(process.execPath, ['tools/lint/run.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lint ok/);
});
