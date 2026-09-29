#!/usr/bin/env node
/**
 * Acceptance-criteria traceability — no dependencies, plain Node.
 *
 *   npm run test:trace                  text report; exit 1 on any problem
 *   npm run test:trace -- --format=json machine-readable report on stdout
 *   node scripts/check-traceability.mjs --root=<dir>   check another tree (tests use fixtures)
 *
 * Acceptance criteria live as tagged Gherkin scenarios in
 * docs/acceptance/v<milestone>/<ISSUE-KEY>.feature (`@AC-QA-TRACE-01`, `@pending`).
 * A test covers an AC when its title starts with the AC ID: `test('AC-QA-TRACE-01: ...')`.
 * Test titles are found statically (no test is run), so the check is fast.
 *
 * Problems (exit 1):
 *   missing                an AC with no test
 *   unknown                a test titled with an AC ID no .feature file defines
 *   duplicate              one AC ID tagged on two scenarios
 *   pending past milestone an `@pending` AC with no test once package.json reaches its milestone
 */
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const AC_ID = /^AC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{2}$/;
const TITLE = /\b(?:test|it|describe)\s*\(\s*(['"`])(AC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{2})\b/g;
const TEST_FILE = /\.(?:c|m)?js$/;

/** Every file under `dir` (recursively) whose name matches `pattern`, skipping node_modules. */
export function walk(dir, pattern) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...walk(path, pattern)); }
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out.sort();
}

const posix = (p) => p.split(sep).join('/');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Milestone from a path like docs/acceptance/v0.10.2/X.feature, or null. */
export function milestoneOf(file) {
  const m = /(?:^|\/)v(\d+\.\d+\.\d+)\//.exec(posix(file));
  return m ? m[1] : null;
}

/** Numeric semver comparison of plain `x.y.z` versions. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
  return 0;
}

/**
 * AC IDs defined by a .feature file, each located at its tag line. Tags above
 * `Feature:` apply to every scenario (Gherkin inheritance); tags above a
 * `Scenario:` apply to that scenario only.
 */
export function parseFeature(text, file) {
  const acs = [];
  let featureTags = [], pendingTags = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('@')) {
      pendingTags.push(...line.split(/\s+/).filter((t) => t.startsWith('@')).map((name) => ({ name, line: i + 1 })));
      return;
    }
    if (/^Feature:/.test(line)) { featureTags = pendingTags; pendingTags = []; return; }
    if (!/^Scenario( Outline)?:/.test(line)) return;
    const tags = [...featureTags, ...pendingTags];
    pendingTags = [];
    const pending = tags.some((t) => t.name === '@pending');
    for (const tag of tags) {
      const id = tag.name.slice(1);
      if (AC_ID.test(id)) acs.push({ id, file, line: tag.line, pending });
    }
  });
  return acs;
}

/** AC-tagged test titles: [{ id, file, line }] */
export function findTests(text, file) {
  const out = [];
  for (const m of text.matchAll(TITLE)) out.push({ id: m[2], file, line: lineAt(text, m.index) });
  return out;
}

function collect(root) {
  const read = (f) => readFileSync(f, 'utf8');
  const features = walk(join(root, 'docs', 'acceptance'), /\.feature$/)
    .flatMap((f) => parseFeature(read(f), posix(relative(root, f))));
  const tests = walk(join(root, 'tests'), TEST_FILE)
    .flatMap((f) => findTests(read(f), posix(relative(root, f))));
  const pkgPath = join(root, 'package.json');
  const version = existsSync(pkgPath) ? JSON.parse(read(pkgPath)).version : '0.0.0';
  return { features, tests, version };
}

function statusOf(ac, covering, version) {
  if (covering.length) return 'covered';
  if (!ac.pending) return 'missing';
  const milestone = milestoneOf(ac.file);
  return milestone && compareVersions(version, milestone) >= 0 ? 'pending-past-milestone' : 'pending';
}

/** The whole report, as plain data. `ok` is false when anything needs fixing. */
export function checkTraceability(root) {
  const { features, tests, version } = collect(root);
  const byId = new Map();
  for (const ac of features) byId.set(ac.id, [...(byId.get(ac.id) || []), ac]);

  const where = (x) => x.file + ':' + x.line;
  const items = [...byId.values()].map((defs) => {
    const ac = defs[0];
    const covering = tests.filter((t) => t.id === ac.id).map(where);
    return { id: ac.id, status: statusOf(ac, covering, version), feature: where(ac), tests: covering };
  });
  const duplicates = [...byId.values()].filter((d) => d.length > 1).map((d) => ({ id: d[0].id, locations: d.map(where) }));
  for (const t of tests.filter((x) => !byId.has(x.id))) {
    items.push({ id: t.id, status: 'unknown', feature: null, tests: [where(t)] });
  }

  const count = (s) => items.filter((i) => i.status === s).length;
  const report = {
    version,
    covered: count('covered'), missing: count('missing'), pending: count('pending'),
    unknown: count('unknown'), pastMilestone: count('pending-past-milestone'), duplicate: duplicates.length,
    items, duplicates,
  };
  report.ok = !report.missing && !report.unknown && !report.pastMilestone && !report.duplicate;
  return report;
}

/** Human-readable report: progress to stdout, problems to stderr. */
export function formatText(report) {
  const out = [], err = [];
  for (const i of report.items) {
    if (i.status === 'covered') out.push(`covered: ${i.id} (${i.tests.join(', ')})`);
    else if (i.status === 'pending') out.push(`pending: ${i.id} (${i.feature})`);
    else if (i.status === 'missing') err.push(`missing: ${i.id} (${i.feature})`);
    else if (i.status === 'unknown') err.push(`unknown: ${i.id} (${i.tests.join(', ')})`);
    else err.push(`pending past milestone: ${i.id} (${i.feature}; package.json is ${report.version})`);
  }
  for (const d of report.duplicates) err.push(`duplicate: ${d.id} (${d.locations.join(', ')})`);
  out.push(`${report.covered} covered, ${report.missing} missing, ${report.pending} pending, ` +
           `${report.unknown} unknown, ${report.duplicate} duplicate, ${report.pastMilestone} past milestone`);
  return { out: out.join('\n'), err: err.join('\n') };
}

function main(argv) {
  const opt = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const report = checkTraceability(opt('root') || process.cwd());
  if (opt('format') === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const { out, err } = formatText(report);
    process.stdout.write(out + '\n');
    if (err) process.stderr.write(err + '\n');
  }
  process.exitCode = report.ok ? 0 : 1;
}

// Self-contained on purpose (AC-QA-TRACE-07: node: imports only, runs when copied alone), so this
// repeats scripts/is-main.mjs: compare real paths, or a symlinked path makes the check a silent pass.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
