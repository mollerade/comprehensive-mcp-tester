#!/usr/bin/env node
/**
 * Release notes — no dependencies, plain Node.
 *
 *   node scripts/release-notes.mjs --highlights=docs/releases/v0.10.1.md \
 *     --generated=generated.md --checksums=SHA256SUMS > notes.md
 *
 * Composes the GitHub release body in the project's fixed layout:
 *   ## Highlights ⭐️   written by hand, kept in docs/releases/v<VERSION>.md
 *   ## What's Changed  and ## New Contributors, as GitHub's generate-notes API returns them
 *   ## Checksums       SHA256SUMS in a fenced block
 *   **Full Changelog** last, from the generated notes
 * Only the highlights are hand-written; everything else is generated.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FULL_CHANGELOG = /^\*\*Full Changelog\*\*:.*$/m;

/** The release body from its three sources; throws when a source is unusable */
export function composeNotes({ highlights, generated, checksums }) {
  const h = highlights.trim();
  if (!/^## Highlights ⭐️$/m.test(h)) throw new Error('highlights must contain a "## Highlights ⭐️" section');
  if (!/^\* \*\*[^*]+\*\*: /m.test(h)) throw new Error('highlights need at least one "* **Feature**: ..." bullet');
  const full = FULL_CHANGELOG.exec(generated);
  if (!full) throw new Error('generated notes have no **Full Changelog** line');
  const sums = checksums.trim();
  if (!sums || !sums.split('\n').every((l) => /^[0-9a-f]{64} {2}\S/.test(l))) throw new Error('checksums must be sha256sum output');
  const changes = generated.replace(FULL_CHANGELOG, '').trim();
  return [h, changes, '## Checksums\n\n```\n' + sums + '\n```', full[0]].join('\n\n') + '\n';
}

function main(argv) {
  const opt = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); if (!a) throw new Error(`--${name}= is required`); return readFileSync(a.slice(name.length + 3), 'utf8'); };
  process.stdout.write(composeNotes({ highlights: opt('highlights'), generated: opt('generated'), checksums: opt('checksums') }));
}

// Real paths on both sides: a symlinked checkout must not turn this into a silent no-op
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
