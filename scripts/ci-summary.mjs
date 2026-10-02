#!/usr/bin/env node
/**
 * Failing tests from a JUnit report, grouped by acceptance criterion, for the
 * GitHub job summary — no dependencies, plain Node.
 *
 *   node scripts/ci-summary.mjs reports/junit-node24.xml
 *
 * Appends a Markdown table to $GITHUB_STEP_SUMMARY (or prints it when unset).
 * A test counts as tagged when its name starts with an AC ID
 * ("AC-QA-CI-04: ..."); other failures are listed as (untagged).
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { isMain } from './is-main.mjs';

const AC_ID = /^(AC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{2})\b/;

function unescapeXml(text) {
  return text.replace(/&(lt|gt|quot|apos|#10|#13|#9|amp);/g, (_, e) =>
    ({ lt: '<', gt: '>', quot: '"', apos: "'", '#10': '\n', '#13': '\r', '#9': '\t', amp: '&' })[e]);
}

/** Every failing test case in a JUnit document: [{ ac, name }] */
export function failingTests(xml) {
  const out = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    if (!/\sfailure="/.test(attrs)) continue;
    const name = unescapeXml((/\sname="([^"]*)"/.exec(attrs) || [])[1] || '(unnamed)');
    const ac = AC_ID.exec(name);
    out.push({ ac: ac ? ac[1] : '(untagged)', name });
  }
  return out;
}

/** A Markdown table cell: backslashes first, then pipes, so an escape in the input cannot unescape a pipe */
const cell = (text) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The Markdown summary for one report */
export function summary(xml, label) {
  const failures = failingTests(xml);
  if (!failures.length) return `### ${label}: no failing tests\n`;
  const rows = failures.map((f) => `| ${cell(f.ac)} | ${cell(f.name)} |`);
  return [`### ${label}: ${failures.length} failing test${failures.length === 1 ? '' : 's'}`, '', '| Acceptance criterion | Test |', '| :--- | :--- |', ...rows, ''].join('\n');
}

function main([file]) {
  if (!file || !existsSync(file)) {
    process.stderr.write(`no JUnit report at ${file || '(none given)'}\n`);
    process.exitCode = 1;
    return;
  }
  const text = summary(readFileSync(file, 'utf8'), file.replace(/^.*\//, ''));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  else process.stdout.write(text);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
