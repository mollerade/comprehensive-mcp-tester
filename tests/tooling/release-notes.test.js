/**
 * Release notes (scripts/release-notes.mjs): the body is composed in the
 * project's fixed order, and unusable inputs are refused rather than published.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeNotes } from '../../scripts/release-notes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HIGHLIGHTS = '## Highlights ⭐️\n\n* **Faster**: it is faster.\n';
const GENERATED = "## What's Changed\n* fix: a thing by @someone in https://github.com/o/r/pull/1\n\n## New Contributors\n* @someone made their first contribution\n\n**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.0.1";
const SUMS = 'a'.repeat(64) + '  worker.js\n' + 'b'.repeat(64) + '  SHA256SUMS-free.json\n';

test('the notes follow Highlights, What\'s Changed, New Contributors, Checksums, Full Changelog', () => {
  const notes = composeNotes({ highlights: HIGHLIGHTS, generated: GENERATED, checksums: SUMS });
  const order = ['## Highlights ⭐️', "## What's Changed", '## New Contributors', '## Checksums', '**Full Changelog**'].map((h) => notes.indexOf(h));
  assert.ok(order.every((i) => i >= 0), 'a section is missing');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections out of order');
  assert.match(notes, /## Checksums\n\n```\naaaa[a]+ {2}worker\.js\n/);
  assert.ok(notes.trimEnd().endsWith('compare/v1.0.0...v1.0.1'), 'Full Changelog must be the last line');
  assert.equal(notes.match(/\*\*Full Changelog\*\*/g).length, 1);
});

test('unusable inputs are refused', () => {
  assert.throws(() => composeNotes({ highlights: '* **X**: y\n', generated: GENERATED, checksums: SUMS }), /Highlights/);
  assert.throws(() => composeNotes({ highlights: '## Highlights ⭐️\n\nNothing yet.\n', generated: GENERATED, checksums: SUMS }), /bullet/);
  assert.throws(() => composeNotes({ highlights: HIGHLIGHTS, generated: "## What's Changed\n", checksums: SUMS }), /Full Changelog/);
  assert.throws(() => composeNotes({ highlights: HIGHLIGHTS, generated: GENERATED, checksums: '' }), /sha256sum/);
  assert.throws(() => composeNotes({ highlights: HIGHLIGHTS, generated: GENERATED, checksums: 'not a checksum  file\n' }), /sha256sum/);
});

test('every committed highlights file is usable', () => {
  const files = readdirSync(join(ROOT, 'docs/releases')).filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.doesNotThrow(() => composeNotes({ highlights: readFileSync(join(ROOT, 'docs/releases', f), 'utf8'), generated: GENERATED, checksums: SUMS }), f);
  }
});
