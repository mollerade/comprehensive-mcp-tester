/**
 * Every runnable script does its work when invoked through a symlinked path
 * (macOS /tmp, a symlinked home or checkout). Node resolves import.meta.url
 * through symlinks but not argv[1], and a naive "am I main?" check then
 * exits 0 having done nothing: for a checker, a silent false pass.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'symlinked-repo-'));
const LINK = join(dir, 'repo');
symlinkSync(ROOT, LINK, 'dir');
after(() => rmSync(dir, { recursive: true, force: true }));

function run(script, args = []) {
  return spawnSync(process.execPath, [join(LINK, script), ...args], { cwd: LINK, encoding: 'utf8' });
}

const CHECKS = [
  ['scripts/check-traceability.mjs', /\d+ covered, \d+ missing/],
  ['scripts/check-readme.mjs', /structure ok/],
  ['scripts/check-links.mjs', /links ok/],
];

for (const [script, expected] of CHECKS) {
  test(`${script} runs through a symlinked path`, () => {
    const r = run(script);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, expected, 'no output: the script exited without running');
  });
}

test('scripts/build.mjs builds through a symlinked path', () => {
  const r = run('scripts/build.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /built:/, 'no output: the build exited without running');
});

test('the mock server starts through a symlinked path', async () => {
  const child = spawn(process.execPath, [join(LINK, 'tests/fixtures/mock-mcp-server.mjs')], { cwd: LINK, env: { ...process.env, PORT: '0' } });
  try {
    const started = await new Promise((resolve) => {
      let out = '';
      const timer = setTimeout(() => resolve(out), 5000);
      child.stdout.on('data', (c) => { out += c; if (/Mock MCP server at/.test(out)) { clearTimeout(timer); resolve(out); } });
      child.on('exit', () => { clearTimeout(timer); resolve(out); });
    });
    assert.match(started, /Mock MCP server at http:\/\/127\.0\.0\.1:\d+/, 'the mock server exited without starting');
  } finally {
    child.kill();
  }
});
