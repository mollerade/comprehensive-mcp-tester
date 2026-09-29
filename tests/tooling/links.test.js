/**
 * Markdown link check (scripts/check-links.mjs): the repository is clean, and
 * each kind of broken link is caught in a fixture tree.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brokenLinks, githubSlug } from '../../scripts/check-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'links-'));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

test('every relative link and anchor in the repository resolves', () => {
  assert.deepEqual(brokenLinks(ROOT), []);
});

test('headings slug the way GitHub does', () => {
  assert.equal(githubSlug('The `/proxy` contract'), 'the-proxy-contract');
  assert.equal(githubSlug('When not to use MCP Tester'), 'when-not-to-use-mcp-tester');
  assert.equal(githubSlug('Highlights ⭐️'), 'highlights-');
  assert.equal(githubSlug('CI gates, and how to run them locally'), 'ci-gates-and-how-to-run-them-locally');
});

test('a missing file, a missing anchor and a missing image are reported with file and line', () => {
  const root = tree({
    'README.md': '# Top\n\n[ok](docs/a.md#part-one) [gone](docs/nope.md)\n[bad anchor](docs/a.md#part-three)\n<img src="logo.svg" />\n',
    'docs/a.md': '# A\n\n## Part one\n',
  });
  const problems = brokenLinks(root);
  assert.deepEqual(problems, [
    'README.md:3: docs/nope.md (missing file)',
    'README.md:4: docs/a.md#part-three (missing anchor)',
    'README.md:5: logo.svg (missing file)',
  ]);
});

test('repeated headings get GitHub\'s numbered anchors; code and external links are ignored', () => {
  const root = tree({
    'a.md': '# A\n\n## Added\n\n## Added\n\n[second](#added-1) [web](https://example.invalid/x) `[code](nope.md)`\n\n```md\n[fenced](nope.md)\n```\n',
  });
  assert.deepEqual(brokenLinks(root), []);
  assert.deepEqual(brokenLinks(tree({ 'a.md': '## Added\n\n[third](#added-2)\n' })), ['a.md:3: #added-2 (missing anchor)']);
});

test('the CLI exits 1 on a broken link', () => {
  const root = tree({ 'README.md': '[gone](missing.md)\n' });
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-links.mjs'), '--root=' + root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /README\.md:1: missing\.md \(missing file\)/);
});
