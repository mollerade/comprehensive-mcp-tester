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
