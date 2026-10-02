/**
 * Governance files (#46): present, filled in, and reachable from the README.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('AC-GOV-COMPLIANCE-01: governance files present', () => {
  for (const f of ['SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', '.github/pull_request_template.md', '.github/dependabot.yml']) {
    assert.ok(existsSync(join(ROOT, f)), 'missing ' + f);
    assert.ok(read(f).trim().length > 100, f + ' is a stub');
  }
  const templates = readdirSync(join(ROOT, '.github', 'ISSUE_TEMPLATE')).filter((f) => f.endsWith('.md'));
  assert.ok(templates.length >= 2, 'expected bug and feature issue templates, got ' + templates.join(', '));

  const readme = read('README.md');
  for (const f of ['SECURITY.md', 'CONTRIBUTING.md']) assert.ok(readme.includes('](' + f + ')'), 'README does not link ' + f);
  assert.ok(read('CONTRIBUTING.md').includes('](CODE_OF_CONDUCT.md)'), 'CONTRIBUTING.md does not link the code of conduct');
  assert.match(read('SECURITY.md'), /security\/advisories\/new/, 'SECURITY.md has no private reporting channel');
  assert.match(read('CONTRIBUTING.md'), /^## Acceptance criteria and regression tests$/m);
});

test('AC-GOV-COMPLIANCE-02: license is declared once chosen', () => {
  const spdx = 'PolyForm-Noncommercial-1.0.0';
  assert.ok(existsSync(join(ROOT, 'LICENSE.md')), 'missing LICENSE.md');
  const license = read('LICENSE.md');
  assert.match(license, /^# PolyForm Noncommercial License 1\.0\.0$/m);
  assert.match(license, /^Required Notice: Copyright /m, 'the licensor\'s Required Notice line');
  assert.equal(JSON.parse(read('package.json')).license, spdx);
  assert.match(read('CITATION.cff'), new RegExp('^license: ' + spdx + '$', 'm'));
  assert.equal(read('README.md').split('\n')[0], '<!-- SPDX-License-Identifier: ' + spdx + ' -->');
  // Copies carry the terms' URL and the Required Notice (the licence's Notices section)
  const notice = license.match(/^Required Notice: .*$/m)[0];
  for (const f of ['src/ui/index.html', 'scripts/build.mjs']) {
    assert.ok(read(f).includes(notice), f + ' does not carry the Required Notice');
    assert.ok(read(f).includes('https://polyformproject.org/licenses/noncommercial/1.0.0'), f + ' does not link the terms');
  }
});

test('the community and agent files are present and filled in', () => {
  for (const f of ['GOVERNANCE.md', 'SUPPORT.md', 'CITATION.cff', 'AGENTS.md', '.pre-commit-config.yaml', '.devcontainer/devcontainer.json']) {
    assert.ok(existsSync(join(ROOT, f)), 'missing ' + f);
    assert.ok(read(f).trim().length > 100, f + ' is a stub');
  }
  assert.match(read('CLAUDE.md'), /^@AGENTS\.md$/m, 'CLAUDE.md must import AGENTS.md, not keep a second copy');
  assert.match(read('CITATION.cff'), /^cff-version: 1\.2\.0$/m);
});

test('every GitHub Action is pinned by commit', () => {
  const dir = join(ROOT, '.github', 'workflows');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml'))) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      assert.match(m[1], /@[0-9a-f]{40}$/, f + ': ' + m[1] + ' is not pinned by commit');
    }
  }
});
