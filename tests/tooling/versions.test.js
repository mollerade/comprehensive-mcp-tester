/**
 * Version consistency (scripts/check-versions.mjs): the repository agrees
 * with itself, and each kind of drift is caught in a fixture tree.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionProblems } from '../../scripts/check-versions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function tree({ pkg = '1.2.3', lock = pkg, lockRoot = pkg, client = pkg, changelog = '# Changelog\n\n## [1.2.3] - 2026-01-01\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'versions-'));
  made.push(dir);
  mkdirSync(join(dir, 'src/ui/js'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: pkg }));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'x', version: lock, packages: { '': { name: 'x', version: lockRoot } } }));
  writeFileSync(join(dir, 'src/ui/js/state.js'), `var CLIENT_INFO = { name: 'MCP Tester', version: '${client}' };\n`);
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  return dir;
}

test('every version reference in the repository agrees', () => {
  assert.deepEqual(versionProblems(ROOT), []);
});

test('a consistent tree passes, in release mode too', () => {
  assert.deepEqual(versionProblems(tree()), []);
  assert.deepEqual(versionProblems(tree(), { tag: 'v1.2.3' }), []);
});

test('drift in the lockfile or the UI is caught', () => {
  assert.deepEqual(versionProblems(tree({ lock: '0.8.0' })), ['package-lock.json (version) is 0.8.0, package.json is 1.2.3']);
  assert.deepEqual(versionProblems(tree({ lockRoot: '0.8.0' })), ['package-lock.json (packages[""].version) is 0.8.0, package.json is 1.2.3']);
  assert.deepEqual(versionProblems(tree({ client: '1.2.2' })), ['src/ui/js/state.js (CLIENT_INFO.version) is 1.2.2, package.json is 1.2.3']);
});

test('release mode needs a matching tag and a changelog heading', () => {
  assert.deepEqual(versionProblems(tree(), { tag: 'v1.2.4' }), ['tag v1.2.4 does not match package.json version 1.2.3 (expected v1.2.3)']);
  assert.deepEqual(versionProblems(tree({ changelog: '# Changelog\n\n## [Unreleased]\n\n## [1.2.30]\n' }), { tag: 'v1.2.3' }),
    ['CHANGELOG.md has no "## [1.2.3]" heading']);
});

test('the CLI exits 1 and names every problem', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check-versions.mjs'), '--root=' + tree({ client: '9.9.9' }), '--tag=v1.2.3'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CLIENT_INFO\.version\) is 9\.9\.9/);
});
