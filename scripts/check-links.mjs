#!/usr/bin/env node
/**
 * Link check for the repository's Markdown — no dependencies, plain Node.
 *
 *   npm run check:links        exit 1 on any broken link
 *   node scripts/check-links.mjs --root=<dir>   check another tree (tests use fixtures)
 *
 * Every relative link and image in every .md file must point at a file that
 * exists, and a #fragment must match a heading in the target, slugged the
 * way GitHub does it. External (http, mailto) links are not fetched.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { isMain } from './is-main.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\bsrc="([^"]+)"/g;

function markdownFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...markdownFiles(join(dir, e.name))); }
    else if (e.name.endsWith('.md')) out.push(join(dir, e.name));
  }
  return out.sort();
}

/** Lines outside fenced code blocks, with inline code removed */
function proseLines(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return ''; }
    return fenced ? '' : line.replace(/`[^`]*`/g, '');
  });
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens */
export function githubSlug(heading) {
  return heading.trim().toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchorsOf(file, cache) {
  if (!cache.has(file)) {
    const seen = new Map(), anchors = new Set();
    let fenced = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      const m = !fenced && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      if (!m) continue;
      const base = githubSlug(m[1]);
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      anchors.add(n ? `${base}-${n}` : base);
    }
    cache.set(file, anchors);
  }
  return cache.get(file);
}

function checkLink(file, link, cache) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return null;           // http:, https:, mailto:
  const [path, fragment] = link.split('#');
  const target = path ? join(dirname(file), decodeURIComponent(path)) : file;
  if (!existsSync(target)) return 'missing file';
  if (fragment && statSync(target).isFile() && target.endsWith('.md') && !anchorsOf(target, cache).has(fragment.toLowerCase())) return 'missing anchor';
  return null;
}

/** Every broken link under root, as "file:line: link (reason)" */
export function brokenLinks(root) {
  const problems = [], cache = new Map();
  for (const file of markdownFiles(root)) {
    proseLines(readFileSync(file, 'utf8')).forEach((line, i) => {
      for (const m of line.matchAll(LINK)) {
        const link = m[1] || m[2];
        const reason = checkLink(file, link, cache);
        if (reason) problems.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${link} (${reason})`);
      }
    });
  }
  return problems;
}

function main(argv) {
  const arg = argv.find((a) => a.startsWith('--root='));
  const root = arg ? arg.slice('--root='.length) : process.cwd();
  const problems = brokenLinks(root);
  if (problems.length) {
    process.stderr.write(problems.join('\n') + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(`links ok (${markdownFiles(root).length} Markdown files)\n`);
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
