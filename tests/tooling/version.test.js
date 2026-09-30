/**
 * The version tool (scripts/version.mjs, #7): bump and check follow the
 * +0.0.1 policy, and a bump updates every place the version lives.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'version.mjs');
const REPO = 'https://github.com/example/tester';
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- First fix.
- Second fix.

## [0.0.1] - 2026-09-01

- The first release.

[Unreleased]: ${REPO}/compare/v0.0.1...HEAD
[0.0.1]: ${REPO}/releases/tag/v0.0.1
`;

function tree(version) {
  const dir = mkdtempSync(join(tmpdir(), 'version-'));
  made.push(dir);
  mkdirSync(join(dir, 'src/ui/js'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mcp-tester', version, private: true }, null, 2) + '\n');
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'mcp-tester', version, lockfileVersion: 3, packages: { '': { name: 'mcp-tester', version } } }, null, 2) + '\n');
  writeFileSync(join(dir, 'src/ui/js/state.js'), `var CLIENT_INFO = { name: 'MCP Tester', version: '${version}' };\n`);
  writeFileSync(join(dir, 'README.md'), `MCP Tester is pre-1.0 (currently ${version}).\n`);
  writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
  return dir;
}

function run(dir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root=' + dir, '--repo-url=' + REPO], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const read = (dir, f) => readFileSync(join(dir, f), 'utf8');
const versionIn = (dir) => JSON.parse(read(dir, 'package.json')).version;

test('AC-QA-VERSION-01: normal bump', () => {
  const dir = tree('0.0.1');
  const r = run(dir, 'bump', '--date=2026-10-01');
  assert.equal(r.code, 0, r.err);
  assert.equal(versionIn(dir), '0.0.2');
  const lock = JSON.parse(read(dir, 'package-lock.json'));
  assert.equal(lock.version, '0.0.2');
  assert.equal(lock.packages[''].version, '0.0.2');
  assert.match(read(dir, 'src/ui/js/state.js'), /version: '0\.0\.2'/);
  assert.match(read(dir, 'README.md'), /currently 0\.0\.2\b/);
});

test('AC-QA-VERSION-02: patch rollover', () => {
  const dir = tree('0.0.999');
  assert.equal(run(dir, 'bump', '--date=2026-10-01').code, 0);
  assert.equal(versionIn(dir), '0.1.0');
});

test('AC-QA-VERSION-03: minor rollover', () => {
  const dir = tree('0.999.999');
  assert.equal(run(dir, 'bump', '--date=2026-10-01').code, 0);
  assert.equal(versionIn(dir), '1.0.0');
});

test('AC-QA-VERSION-04: skipping a version is rejected', () => {
  const r = run(tree('0.0.3'), 'check', '--base', '0.0.1');
  assert.equal(r.code, 1);
  assert.match(r.err, /version must be 0\.0\.2 \(got 0\.0\.3\)/);
});

test('AC-QA-VERSION-05: invalid versions are rejected', () => {
  const cases = [['0.0.1000', /range/], ['0.0.x', /numeric/], ['0.0.2-rc.1', /pre-release/], ['0.0.0', /must increase/]];
  for (const [candidate, rule] of cases) {
    const r = run(tree(candidate), 'check', '--base', '0.0.1');
    assert.equal(r.code, 1, candidate + ' was accepted');
    assert.match(r.err, rule, candidate + ': ' + r.err);
  }
  assert.equal(run(tree('0.0.2'), 'check', '--base', '0.0.1').code, 0, 'the next version passes');
});

test('AC-QA-VERSION-06: changelog heading added', () => {
  const dir = tree('0.0.1');
  assert.equal(run(dir, 'bump', '--date=2026-10-01').code, 0);
  const log = read(dir, 'CHANGELOG.md');
  assert.match(log, /## \[Unreleased\]\n\n## \[0\.0\.2\] - 2026-10-01\n\n### Fixed\n\n- First fix\.\n- Second fix\.\n/);
  assert.match(log, /^\[Unreleased\]: https:\/\/github\.com\/example\/tester\/compare\/v0\.0\.2\.\.\.HEAD$/m);
  assert.match(log, /^\[0\.0\.2\]: https:\/\/github\.com\/example\/tester\/compare\/v0\.0\.1\.\.\.v0\.0\.2$/m);
  assert.equal(run(dir, 'bump', '--date=2026-10-02').code, 0, 'the next bump works on the result');
  assert.match(read(dir, 'CHANGELOG.md'), /## \[Unreleased\]\n\n## \[0\.0\.3\] - 2026-10-02\n\n## \[0\.0\.2\] - 2026-10-01/);
});

test('without --base, the version may be the last release tag or exactly the next one', () => {
  // A directory outside any git repository has no tags, so the last release counts as 0.0.0
  assert.equal(run(tree('0.0.0'), 'check').code, 0);
  assert.equal(run(tree('0.0.1'), 'check').code, 0);
  const r = run(tree('0.0.2'), 'check');
  assert.equal(r.code, 1);
  assert.match(r.err, /version must be 0\.0\.1 \(got 0\.0\.2\)/);
});

test('the repository itself passes the check', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
