#!/usr/bin/env node
/**
 * Versions — no dependencies, plain Node. The policy is in docs/POLICIES.md:
 * every release increments by exactly 0.0.1, each part runs 0 to 999
 * (x.y.999 is followed by x.(y+1).0, x.999.999 by (x+1).0.0), and there are
 * no pre-release or build suffixes.
 *
 *   npm run version:bump                  set the next version everywhere
 *   npm run version:check                 the version is the last release tag, or the one after it
 *   npm run version:check -- --base 0.0.1 the version is exactly the one after 0.0.1
 *
 * bump updates package.json, both version fields of package-lock.json,
 * CLIENT_INFO in src/ui/js/state.js (what the UI shows and reports to
 * servers) and the README's "currently X.Y.Z", and turns CHANGELOG.md's
 * Unreleased section into "## [X.Y.Z] - <date>" under a new empty Unreleased.
 * Options: --root=<dir>, --date=YYYY-MM-DD (default today, UTC),
 * --repo-url=<https://github.com/owner/repo> for the changelog links.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMain } from './is-main.mjs';

const MAX_PART = 999;

/** A version's parts, or the policy rule it breaks */
export function parseVersion(v) {
  if (/[-+]/.test(v)) return { error: `no pre-release or build suffix is allowed (got ${v})` };
  if (!/^\d+\.\d+\.\d+$/.test(v)) return { error: `version must be numeric major.minor.patch (got ${v})` };
  const parts = v.split('.').map(Number);
  if (parts.some((p) => p > MAX_PART)) return { error: `each part must be in the range 0 to ${MAX_PART} (got ${v})` };
  return { parts };
}

/** The version after v: +0.0.1, rolling over at 999 */
export function nextVersion(v) {
  const { parts, error } = parseVersion(v);
  if (error) throw new Error(error);
  let [major, minor, patch] = parts;
  patch += 1;
  if (patch > MAX_PART) { patch = 0; minor += 1; }
  if (minor > MAX_PART) { minor = 0; major += 1; }
  return [major, minor, patch].join('.');
}

const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/** Why `candidate` may not follow `base`, or null */
export function versionRuleBroken(candidate, base) {
  const c = parseVersion(candidate);
  if (c.error) return c.error;
  const b = parseVersion(base);
  if (b.error) return 'base: ' + b.error;
  if (compare(c.parts, b.parts) <= 0) return `version must increase (got ${candidate}, base ${base})`;
  const expected = nextVersion(base);
  return candidate === expected ? null : `version must be ${expected} (got ${candidate})`;
}

/** The newest v* release tag's version, or 0.0.0 before the first release */
function latestTagVersion(root) {
  try {
    const tags = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { cwd: root, encoding: 'utf8' }).split('\n');
    const tag = tags.find((t) => !parseVersion(t.slice(1)).error);
    return tag ? tag.slice(1) : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const readJson = (root, f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const writeJson = (root, f, obj) => writeFileSync(join(root, f), JSON.stringify(obj, null, 2) + '\n');

function replaceOnce(text, pattern, replacement, what) {
  if (!pattern.test(text)) throw new Error(`cannot find ${what}`);
  return text.replace(pattern, replacement);
}

/** CHANGELOG.md with Unreleased turned into a dated release, and its links updated */
export function releaseChangelog(text, version, date, repoUrl) {
  const heading = '## [Unreleased]';
  if (!text.includes(heading + '\n')) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  if (text.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has a "## [${version}]" heading`);
  let out = text.replace(heading + '\n', `${heading}\n\n## [${version}] - ${date}\n`);
  const unreleasedLink = /^\[Unreleased\]: (\S+)$/m.exec(out);
  const previous = unreleasedLink && /compare\/(\S+)\.\.\.HEAD$/.exec(unreleasedLink[1]);
  const since = previous ? previous[1] : null;
  const links = `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD\n[${version}]: ${since ? `${repoUrl}/compare/${since}...v${version}` : `${repoUrl}/releases/tag/v${version}`}`;
  out = unreleasedLink ? out.replace(unreleasedLink[0], links) : out.trimEnd() + '\n\n' + links + '\n';
  return out;
}

function repoUrlFromGit(root) {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' }).trim();
    const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
    return m ? `https://github.com/${m[1]}` : null;
  } catch {
    return null;
  }
}

/** Set the next version everywhere; returns it */
export function bump(root, { date = new Date().toISOString().slice(0, 10), repoUrl } = {}) {
  const pkg = readJson(root, 'package.json');
  const from = pkg.version, to = nextVersion(from);
  pkg.version = to;
  writeJson(root, 'package.json', pkg);

  const lock = readJson(root, 'package-lock.json');
  lock.version = to;
  if (lock.packages && lock.packages['']) lock.packages[''].version = to;
  writeJson(root, 'package-lock.json', lock);

  const statePath = join(root, 'src/ui/js/state.js');
  writeFileSync(statePath, replaceOnce(readFileSync(statePath, 'utf8'),
    /(CLIENT_INFO\s*=\s*\{[^}]*version:\s*')[^']+(')/, `$1${to}$2`, 'CLIENT_INFO in src/ui/js/state.js'));

  const readmePath = join(root, 'README.md');
  writeFileSync(readmePath, readFileSync(readmePath, 'utf8').replace(new RegExp(`\\bcurrently ${from.replace(/\./g, '\\.')}\\b`, 'g'), `currently ${to}`));

  const changelogPath = join(root, 'CHANGELOG.md');
  const url = repoUrl || repoUrlFromGit(root);
  if (!url) throw new Error('cannot tell the repository URL for the changelog links; pass --repo-url');
  writeFileSync(changelogPath, releaseChangelog(readFileSync(changelogPath, 'utf8'), to, date, url));
  return { from, to };
}

/** The check CI runs: the version is the base (nothing to release yet) or exactly the one after it */
export function check(root, base) {
  const version = readJson(root, 'package.json').version;
  if (base !== undefined) return versionRuleBroken(version, base);
  const released = latestTagVersion(root);
  return version === released ? null : versionRuleBroken(version, released);
}

function main(argv) {
  const [command, ...rest] = argv;
  const opt = (name) => {
    const i = rest.indexOf('--' + name);
    if (i !== -1) return rest[i + 1];
    const a = rest.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : undefined;
  };
  const root = opt('root') || process.cwd();
  if (command === 'bump') {
    const { from, to } = bump(root, { date: opt('date'), repoUrl: opt('repo-url') });
    process.stdout.write(`version ${from} -> ${to}\n`);
  } else if (command === 'check') {
    const problem = check(root, opt('base'));
    if (problem) { process.stderr.write(problem + '\n'); process.exitCode = 1; }
    else process.stdout.write('version ok\n');
  } else {
    process.stderr.write('usage: version.mjs bump|check [--base X.Y.Z] [--root DIR] [--date YYYY-MM-DD] [--repo-url URL]\n');
    process.exitCode = 2;
  }
}

if (isMain(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
