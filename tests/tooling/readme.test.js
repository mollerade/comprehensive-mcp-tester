/**
 * README structure check (scripts/check-readme.mjs): the real README passes,
 * and each kind of drift is caught.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReadme } from '../../scripts/check-readme.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const TOKEN = '{{' + 'PROJECT_NAME' + '}}';

test('the README follows the template layout', () => {
  assert.deepEqual(checkReadme(README), []);
});

test('a missing SPDX comment on line 1 is caught', () => {
  assert.match(checkReadme('\n' + README).join('\n'), /line 1: expected an SPDX-License-Identifier comment/);
});

test('sections out of order are caught', () => {
  const swapped = README.replace('## Requirements', '## TMP').replace('## Install', '## Requirements').replace('## TMP', '## Install');
  const problems = checkReadme(swapped).join('\n');
  assert.match(problems, /section 2 is "## Requirements", expected "## Install"/);
});

test('a missing section and an extra one are caught', () => {
  assert.match(checkReadme(README.replace('## Benchmarks', '## Roadmap')).join('\n'), /expected "## Benchmarks"/);
  assert.match(checkReadme(README + '\n## Roadmap\n').join('\n'), /unexpected section "## Roadmap"/);
});

test('an unfilled template token is caught', () => {
  assert.match(checkReadme(README + '\n' + TOKEN + '\n').join('\n'), /unfilled template token \{\{PROJECT_NAME\}\}/);
});

test('headings inside code fences are not sections', () => {
  const withFence = README.replace('## License', '```md\n## Not a section\n```\n\n## License');
  assert.deepEqual(checkReadme(withFence), []);
});

test('the CLI exits 1 and names the file on a bad README', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readme-'));
  try {
    const file = join(dir, 'README.md');
    writeFileSync(file, '# Nothing like the template\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-readme.mjs'), '--file=' + file], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /README\.md: line 1: expected an SPDX-License-Identifier comment/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
