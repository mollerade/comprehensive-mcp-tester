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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './is-main.mjs';

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
    const heading = '## [' + version + ']';   // compared as text, so no character in the version is special
    if (!changelog.split('\n').some((line) => line.startsWith(heading))) {
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

if (isMain(import.meta.url)) main(process.argv.slice(2));
