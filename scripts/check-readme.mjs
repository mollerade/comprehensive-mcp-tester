#!/usr/bin/env node
/**
 * README structure check — no dependencies, plain Node.
 *
 *   npm run check:readme                     checks README.md
 *   node scripts/check-readme.mjs --file=X   checks another file (tests use fixtures)
 *
 * The README follows a shared layout: an SPDX comment on line 1, a centred
 * <h1> name, then these second-level sections in this order, with every
 * {{UPPER_SNAKE_CASE}} template token filled in. `{name}` is the <h1> text.
 * A stated current version ("currently 1.2.3") must match package.json, so the
 * README cannot go stale on a release.
 * The list mirrors the portfolio's README template, which lives outside this
 * repository, minus its Ecosystem comparison and Benchmarks sections, which do
 * not fit a diagnostic UI; change both together.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isMain } from './is-main.mjs';

export const README_SECTIONS = [
  'Contents', 'Install', 'Requirements', 'Quick Start', 'The {name} ecosystem',
  'Capabilities at a glance', 'Features',
  'Configuration', 'Examples', 'When not to use {name}', 'Development', 'Security',
  'Documentation', 'Stability guarantees', 'License',
];

/** Headings outside fenced code blocks, as { level, text, line } */
function headings(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    const m = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  return out;
}

function sectionOrderProblems(text, name) {
  const expected = README_SECTIONS.map((s) => s.replace('{name}', name));
  const actual = headings(text).filter((h) => h.level === 2);
  const problems = [];
  expected.forEach((want, i) => {
    const got = actual[i];
    if (!got) problems.push(`missing section ${i + 1}: "## ${want}"`);
    else if (got.text !== want) problems.push(`line ${got.line}: section ${i + 1} is "## ${got.text}", expected "## ${want}"`);
  });
  for (const extra of actual.slice(expected.length)) problems.push(`line ${extra.line}: unexpected section "## ${extra.text}"`);
  return problems;
}

/** "currently X.Y.Z" mentions that disagree with the package version */
function versionProblems(text, version) {
  const problems = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\bcurrently (\d+\.\d+\.\d+)\b/g)) {
      if (m[1] !== version) problems.push(`line ${i + 1}: says "currently ${m[1]}" but package.json is ${version}`);
    }
  });
  return problems;
}

/** Every problem with a README's structure; empty when it conforms. `version` is package.json's. */
export function checkReadme(text, { version } = {}) {
  const problems = [];
  if (!/^<!-- SPDX-License-Identifier: \S.*-->$/.test(text.split('\n')[0])) problems.push('line 1: expected an SPDX-License-Identifier comment');
  const h1 = /<h1 align="center">([^<]+)<\/h1>/.exec(text);
  if (!h1) problems.push('missing <h1 align="center"> project name');
  problems.push(...sectionOrderProblems(text, h1 ? h1[1].trim() : '{name}'));
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\{\{[A-Z0-9_]+\}\}/g)) problems.push(`line ${i + 1}: unfilled template token ${m[0]}`);
  });
  if (version) problems.push(...versionProblems(text, version));
  return problems;
}

function main(argv) {
  const arg = argv.find((a) => a.startsWith('--file='));
  const file = arg ? arg.slice('--file='.length) : 'README.md';
  const version = JSON.parse(readFileSync(join(dirname(file), 'package.json'), 'utf8')).version;
  const problems = checkReadme(readFileSync(file, 'utf8'), { version });
  if (problems.length) {
    process.stderr.write(problems.map((p) => `${file}: ${p}`).join('\n') + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(`${file}: structure ok (${README_SECTIONS.length} sections)\n`);
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
