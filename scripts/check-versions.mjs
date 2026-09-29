#!/usr/bin/env node
/**
 * Version consistency — no dependencies, plain Node.
 *
 *   npm run check:versions                  every version reference agrees
 *   node scripts/check-versions.mjs --tag=v0.0.1    release mode, run before publishing
 *   ... --root=<dir>                        check another tree (tests use fixtures)
 *
 * Always: package.json, both version fields at the root of package-lock.json
 * and CLIENT_INFO in src/ui/js/state.js (the version the UI reports to
 * servers) are the same. With --tag, also: the tag is v<that version>, and
 * CHANGELOG.md has a "## [<version>]" heading, so a release cannot ship notes
 * for a different version. The README's "currently X.Y.Z" is checked by
 * check-readme.mjs.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Every version reference, as [where, version or null] */
function references(root) {
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const lock = JSON.parse(read('package-lock.json'));
  const client = /CLIENT_INFO\s*=\s*\{[^}]*version:\s*'([^']+)'/.exec(read('src/ui/js/state.js'));
  return [
    ['package.json', JSON.parse(read('package.json')).version],
    ['package-lock.json (version)', lock.version],
    ['package-lock.json (packages[""].version)', (lock.packages && lock.packages[''] || {}).version],
    ['src/ui/js/state.js (CLIENT_INFO.version)', client ? client[1] : null],
  ];
}

/** Every problem, as text; empty when consistent */
export function versionProblems(root, { tag } = {}) {
  const refs = references(root);
  const version = refs[0][1];
  const problems = refs.slice(1)
    .filter(([, v]) => v !== version)
    .map(([where, v]) => `${where} is ${v === null ? 'missing' : v}, package.json is ${version}`);
  if (tag !== undefined) {
    if (tag !== 'v' + version) problems.push(`tag ${tag} does not match package.json version ${version} (expected v${version})`);
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    if (!new RegExp('^## \\[' + version.replace(/\./g, '\\.') + '\\]', 'm').test(changelog)) {
      problems.push(`CHANGELOG.md has no "## [${version}]" heading`);
    }
  }
  return problems;
}

function main(argv) {
  const opt = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : undefined; };
  const root = opt('root') || process.cwd();
  const problems = versionProblems(root, { tag: opt('tag') });
  if (problems.length) {
    process.stderr.write(problems.join('\n') + '\n');
    process.exitCode = 1;
  } else {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    process.stdout.write(`versions ok (${version}${opt('tag') ? ', tag ' + opt('tag') : ''})\n`);
  }
}

// Real paths on both sides: a symlinked checkout must not turn the check into a silent pass
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
