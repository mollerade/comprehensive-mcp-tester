#!/usr/bin/env node
/**
 * The lint gate: ESLint over the repository, at zero findings, with a
 * complexity baseline that may only shrink.
 *
 *   npm ci --prefix tools/lint                     once: installs ESLint into tools/lint
 *   npm run lint                                   the gate CI runs
 *   npm run lint -- --write-baseline               record improvements (refused while anything is new or worse)
 *
 * Any finding fails, warnings included, except a complexity ceiling
 * (complexity, sonarjs/cognitive-complexity, max-lines-per-function,
 * max-lines) exceeded by a function listed in complexity-baseline.json with a
 * value at least as high. A new offender fails; a worse value fails; an
 * improvement fails until the baseline records it, so the list only shrinks.
 * Functions are keyed by file, rule and name (read from the declaration line,
 * since sonarjs does not name the function); unnamed ones by order in the file.
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const BASELINE = join(HERE, 'complexity-baseline.json');
export const CEILING_RULES = ['complexity', 'sonarjs/cognitive-complexity', 'max-lines-per-function', 'max-lines'];

/** The number a ceiling message reports */
export function measured(message) {
  const m = /complexity of (\d+)|Complexity from (\d+)|too many lines \((\d+)\)/.exec(message);
  return m ? Number(m[1] || m[2] || m[3]) : null;
}

/** The function a declaration line introduces, or null for an unnamed one */
export function declaredName(line) {
  const patterns = [
    /\bfunction\s*\*?\s*([\w$]+)\s*\(/,
    /([\w$]+)\s*[:=]\s*(?:async\s+)?function\b/,
    /([\w$]+)\s*[:=]\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>/,
    /^\s*(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{/,
  ];
  for (const p of patterns) { const m = p.exec(line); if (m && m[1] !== 'function' && m[1] !== 'if') return m[1]; }
  return null;
}

/** Every ceiling offence in the lint results, as { file, rule, name, value } */
export function offences(results, sourceOf) {
  const out = [];
  for (const r of results) {
    const file = relative(ROOT, r.filePath).split(sep).join('/');
    const lines = sourceOf(r).split('\n');
    const unnamed = {};
    for (const m of r.messages) {
      if (!CEILING_RULES.includes(m.ruleId)) continue;
      let name = m.ruleId === 'max-lines' ? '(file)' : declaredName(lines[m.line - 1] || '');
      if (!name) { unnamed[m.ruleId] = (unnamed[m.ruleId] || 0) + 1; name = `(unnamed #${unnamed[m.ruleId]})`; }
      out.push({ file, rule: m.ruleId, name, value: measured(m.message) });
    }
  }
  return out;
}

const relativeFile = (r) => relative(ROOT, r.filePath).split(sep).join('/');

/** Findings that no baseline can excuse: everything but a complexity ceiling, and parse errors */
function plainProblems(results) {
  const out = [];
  for (const r of results) {
    for (const m of r.messages) {
      if (m.fatal || !CEILING_RULES.includes(m.ruleId)) out.push(`${relativeFile(r)}:${m.line}:${m.column} ${m.ruleId || 'parse'}: ${m.message}`);
    }
  }
  return out;
}

/** Offences that are new or worse than the baseline allows */
function regressions(found, baseline) {
  const out = [];
  for (const o of found) {
    const allowed = baseline[o.file]?.[o.rule]?.[o.name];
    if (allowed === undefined) out.push(`${o.file} ${o.rule}: ${o.name} is ${o.value}, over the ceiling, and not in the baseline (new offender)`);
    else if (o.value > allowed) out.push(`${o.file} ${o.rule}: ${o.name} is ${o.value}, worse than its baseline ${allowed}`);
  }
  return out;
}

/** The offences as a nested { file: { rule: { name: value } } } map */
function byFileRuleName(found) {
  const out = {};
  for (const o of found) ((out[o.file] ||= {})[o.rule] ||= {})[o.name] = o.value;
  return out;
}

/** Baseline entries that are now lower or gone */
function improvements(baseline, current) {
  const out = [];
  for (const [file, rules] of Object.entries(baseline)) {
    for (const [rule, names] of Object.entries(rules)) {
      for (const [name, value] of Object.entries(names)) {
        const now = current[file]?.[rule]?.[name];
        if (now === undefined || now < value) out.push(`${file} ${rule}: ${name} ${value} -> ${now === undefined ? 'within the ceiling' : now}`);
      }
    }
  }
  return out;
}

/** Compare lint results with the baseline: { plain, regressed, improved, current } */
export function judge(results, baseline, sourceOf) {
  const found = offences(results, sourceOf);
  const current = byFileRuleName(found);
  return { plain: plainProblems(results), regressed: regressions(found, baseline), improved: improvements(baseline, current), current };
}

/** A baseline object with stable key order, for a readable diff */
export function sortedBaseline(current) {
  const out = {};
  for (const file of Object.keys(current).sort()) {
    out[file] = {};
    for (const rule of Object.keys(current[file]).sort()) {
      out[file][rule] = {};
      for (const name of Object.keys(current[file][rule]).sort()) out[file][rule][name] = current[file][rule][name];
    }
  }
  return out;
}

/** ESLint from tools/lint/node_modules, configured by the repository's eslint.config.mjs */
export async function loadEslint() {
  const require = createRequire(join(HERE, 'package.json'));
  let entry;
  try { entry = require.resolve('eslint'); }
  catch { throw new Error('ESLint is not installed: run `npm ci --prefix tools/lint` first'); }
  const { ESLint } = await import(pathToFileURL(entry).href);
  return new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, 'eslint.config.mjs') });
}

const countOf = (map) => Object.values(map).flatMap((r) => Object.values(r).flatMap(Object.keys)).length;

/** --write-baseline: records improvements; the very first write records every existing offender */
function writeBaseline({ plain, regressed, current }, hadBaseline) {
  const blocking = hadBaseline ? [...plain, ...regressed] : plain;
  if (blocking.length) {
    process.stderr.write(blocking.join('\n') + '\n\nThe baseline records existing offenders and improvements only; fix the problems above first.\n');
    process.exitCode = 1;
    return;
  }
  writeFileSync(BASELINE, JSON.stringify(sortedBaseline(current), null, 2) + '\n');
  process.stdout.write(`baseline written: ${countOf(current)} offender(s)\n`);
}

async function main(argv) {
  const eslint = await loadEslint();
  const results = await eslint.lintFiles(['.']);
  const hadBaseline = existsSync(BASELINE);
  const baseline = hadBaseline ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const verdict = judge(results, baseline, (r) => r.source ?? readFileSync(r.filePath, 'utf8'));
  if (argv.includes('--write-baseline')) return writeBaseline(verdict, hadBaseline);

  const problems = [...verdict.plain, ...verdict.regressed,
    ...verdict.improved.map((i) => `improved, record it with \`npm run lint -- --write-baseline\`: ${i}`)];
  if (problems.length) {
    process.stderr.write(problems.join('\n') + `\n\n${problems.length} lint problem(s)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`lint ok (${results.length} files; ${countOf(baseline)} baselined offender(s), none worse)\n`);
  }
}

// Real paths on both sides (see scripts/is-main.mjs), so a symlinked checkout cannot turn the gate into a silent pass
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(e.message + '\n'); process.exitCode = 1; });
}
