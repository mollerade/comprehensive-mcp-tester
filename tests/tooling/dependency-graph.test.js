/**
 * The Dependency review job runs only where the repository's dependency graph
 * is on: scripts/dependency-graph.mjs decides, against a local stand-in for
 * the GitHub API here.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'graph-')); made.push(d); return d; };

/** Runs scripts/dependency-graph.mjs against a local stand-in for the GitHub API */
async function graphProbe(status) {
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.url + ' ' + req.headers.authorization); res.writeHead(status); res.end('{}'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = tmp(), out = join(dir, 'out'), summary = join(dir, 'summary');
  writeFileSync(out, ''); writeFileSync(summary, '');
  const env = { ...process.env, GITHUB_API_URL: 'http://127.0.0.1:' + server.address().port, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary };
  const r = await new Promise((resolve) => execFile(process.execPath, ['scripts/dependency-graph.mjs'], { cwd: ROOT, env },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
  server.close();
  return { ...r, seen, out: readFileSync(out, 'utf8'), summary: readFileSync(summary, 'utf8') };
}

test('dependency review runs only where the dependency graph is on', async () => {
  const on = await graphProbe(200);
  assert.equal(on.code, 0);
  assert.equal(on.out, 'on=true\n');
  assert.deepEqual(on.seen, ['/repos/o/r/dependency-graph/sbom Bearer t']);
  assert.doesNotMatch(on.stdout, /::warning/);

  const off = await graphProbe(404);
  assert.equal(off.code, 0);
  assert.equal(off.out, 'on=false\n');
  assert.match(off.stdout, /^::warning title=Dependency review skipped::the dependency graph is off for o\/r/m);
  assert.match(off.summary, /^Dependency review skipped: /);

  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /run: node scripts\/dependency-graph\.mjs\n\n\s+- name: No new dependency with a known vulnerability\n\s+if: steps\.graph\.outputs\.on == 'true'\n\s+uses: actions\/dependency-review-action@/);
});

test('any API error other than 404 fails the dependency-graph check', async () => {
  for (const status of [403, 500]) {
    const r = await graphProbe(status);
    assert.equal(r.code, 1, status + ' must fail, not skip the review');
    assert.equal(r.out, '');
    assert.match(r.stderr, new RegExp('GitHub API answered ' + status));
  }
});
