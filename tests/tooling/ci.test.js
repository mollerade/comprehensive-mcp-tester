/**
 * CI gates (#6): the e2e suite fails rather than skips in CI, test:ci writes a
 * JUnit report per Node version, failing AC IDs reach the job summary, and the
 * workflows wire every gate with a timeout.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAJOR = process.versions.node.split('.')[0];
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ci-')); made.push(d); return d; };

function node(args, env) {
  const clean = { ...process.env };
  delete clean.CI;
  delete clean.GITHUB_STEP_SUMMARY;
  delete clean.NODE_TEST_CONTEXT;   // else a nested `node --test` reports to this runner instead of printing
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...clean, ...env } });
}

test('AC-QA-CI-01: e2e cannot silently skip in CI', () => {
  const r = node(['--test', 'tests/e2e.test.mjs'], { CI: 'true', PW_CHROMIUM_PATH: '/nonexistent/chromium' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Chromium is required when CI=true/);
});

test('AC-QA-CI-02: local skip behaviour preserved', () => {
  const r = node(['--test', 'tests/e2e.test.mjs'], { PW_CHROMIUM_PATH: '/nonexistent/chromium' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Playwright\/Chromium not available/);
  assert.match(r.stdout, /ℹ skipped [1-9]/);
});

test('AC-QA-CI-03: JUnit report per Node version', () => {
  const dir = tmp();
  const r = node(['scripts/run-ci-tests.mjs', 'tests/fixtures/ci/passing-suite.mjs'], { REPORTS_DIR: dir });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const file = join(dir, `junit-node${MAJOR}.xml`);
  assert.ok(existsSync(file), 'no report at ' + file);
  const xml = readFileSync(file, 'utf8');
  assert.match(xml, /^<\?xml version="1\.0"[^>]*\?>\s*<testsuites>[\s\S]*<\/testsuites>\s*$/);
  const opened = (xml.match(/<testcase\b/g) || []).length;
  const closed = (xml.match(/<testcase\b[^>]*\/>/g) || []).length + (xml.match(/<\/testcase>/g) || []).length;
  assert.equal(opened, 3, 'one <testcase> per executed test');
  assert.equal(closed, opened, 'every <testcase> is closed');
  assert.match(r.stdout, /✔ first/, 'the spec output still reaches the console');
});

test('AC-QA-CI-04: failing AC IDs in the job summary', () => {
  const summaryFile = join(tmp(), 'summary.md');
  writeFileSync(summaryFile, '');
  const r = node(['scripts/ci-summary.mjs', 'tests/fixtures/ci/failures.xml'], { GITHUB_STEP_SUMMARY: summaryFile });
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(summaryFile, 'utf8');
  assert.match(md, /3 failing tests/);
  assert.match(md, /^\| AC-X-01 \| AC-X-01: a \|$/m);
  assert.match(md, /^\| AC-Y-03 \| AC-Y-03: b \|$/m);
  assert.match(md, /^\| \(untagged\) \| an untagged & failing test \|$/m);
  assert.doesNotMatch(md, /AC-Z-02/, 'passing tests are not listed');
});

test("the summary reads Node's real JUnit output", () => {
  const dir = tmp();
  const run = node(['scripts/run-ci-tests.mjs', 'tests/fixtures/ci/failing-suite.mjs'], { REPORTS_DIR: dir });
  assert.notEqual(run.status, 0, 'the failing fixture must fail the run');
  const r = node(['scripts/ci-summary.mjs', join(dir, `junit-node${MAJOR}.xml`)]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 failing tests/);
  assert.match(r.stdout, /^\| AC-X-01 \| AC-X-01: a \|$/m);
  assert.match(r.stdout, /^\| AC-Y-03 \| AC-Y-03: b \\\| with a pipe \|$/m, 'a pipe in a name is escaped');
  assert.match(r.stdout, /^\| \(untagged\) \| an untagged failure \|$/m);
});

test('AC-QA-CI-05: workflow wires every gate', () => {
  const dir = join(ROOT, '.github', 'workflows');
  const ci = readFileSync(join(dir, 'ci.yml'), 'utf8');
  assert.match(ci, /node: \[22, 24\]/, 'the matrix covers the supported Node versions');
  assert.match(ci, /run: npm run test:ci/);
  assert.match(ci, /run: npm run test:trace/);
  assert.match(ci, /path: reports\//, 'the reports are uploaded');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    const jobs = [...text.split(/^jobs:\n/m)[1].matchAll(/^ {2}([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9-]*:\n|(?![\s\S]))/gm)];
    assert.ok(jobs.length > 0, f + ' has no jobs');
    for (const [, name, body] of jobs) {
      const t = /^ {4}timeout-minutes: (\d+)$/m.exec(body);
      assert.ok(t, `${f}: job ${name} sets no timeout-minutes`);
      assert.ok(Number(t[1]) <= 15, `${f}: job ${name} allows ${t[1]} minutes`);
    }
  }
});

test('no script outside tests/ looks like a test file to a bare `node --test`', () => {
  // Node's default patterns (https://nodejs.org/api/test.html#running-tests-from-the-command-line)
  const looksLikeTest = /(^|[\/])(test|test-[^\/]*|[^\/]*[.\-_]test)\.[cm]?js$/;
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'build', 'reports', 'tests'].includes(e.name)) continue;
      const rel = dir ? dir + '/' + e.name : e.name;
      if (e.isDirectory()) { if (e.name === 'test') offenders.push(rel + '/'); else walk(rel); }
      else if (looksLikeTest.test(rel)) offenders.push(rel);
    }
  };
  walk('');
  assert.deepEqual(offenders, [], 'a bare `node --test` would run these as tests');
});
