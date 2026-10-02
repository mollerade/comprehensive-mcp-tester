#!/usr/bin/env node
/**
 * Grade one MCP server against the compliance catalogue, from the command line.
 *
 *   npm run compliance -- https://developer.hsbc.com/mcp
 *   npm run compliance -- http://127.0.0.1:8788/mcp --json
 *   npm run compliance -- <url> --header "Authorization: Bearer $TOKEN"
 *
 * The probes go through the same proxy core and checked fetch as the local
 * server; the target's own origin is listed, so a local or internal server can
 * be graded, but a redirect elsewhere is still checked. Prints a Markdown
 * report (or the report as JSON). Exit code: 0 pass or warn, 1 fail or no answer, 2 usage.
 * Headers are sent to the target only, and never printed.
 */
import { proxyMcp } from '../src/core/proxy.js';
import { createGuardedFetch } from '../src/hosts/guarded-fetch.js';
import { collectCompliance } from '../src/core/compliance/collect.js';
import { runCompliance } from '../src/core/compliance/engine.js';
import { COMPLIANCE_CATALOGUE } from '../src/core/compliance/catalogue.js';
import { isMain } from './is-main.mjs';

const USAGE = 'usage: npm run compliance -- <server url> [--header "Name: value"]... [--json]';
const MARK = { pass: 'pass', warn: 'WARN', fail: 'FAIL', error: 'ERROR', skipped: 'skipped', 'not-applicable': 'n/a' };

/** argv → { url, headers, json } or { error } */
export function parseArgs(argv) {
  const out = { url: null, headers: {}, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--header') {
      const h = argv[++i] || '', colon = h.indexOf(':');
      if (colon < 1) return { error: 'a --header needs "Name: value"' };
      out.headers[h.slice(0, colon).trim().toLowerCase()] = h.slice(colon + 1).trim();
    } else if (!out.url && !a.startsWith('--')) out.url = a;
    else return { error: 'unexpected argument: ' + a };
  }
  if (!out.url) return { error: 'a server url is required' };
  try { new URL(out.url); } catch { return { error: 'not a URL: ' + out.url }; }
  return out;
}

/** The collector's send(), over the proxy core */
export function proxySend(allowTargets, doFetch) {
  return async function (url, init) {
    const r = await proxyMcp({ url, method: init.method, headers: init.headers, body: init.body, timeoutMs: 15000 },
      { fetch: doFetch, allowTargets, allowAnyPublic: false, colo: 'cli' });
    if (r.status !== 200) return { error: r.json.error + (r.json.hint ? ' ' + r.json.hint : '') };
    if (r.json.status === 0) return { error: r.json.diag.errorDetail };
    return { status: r.json.status, headers: r.json.headers, body: r.json.body };
  };
}

const cell = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function markdownReport(url, ctx, report) {
  const lines = [
    '# MCP compliance: ' + url, '',
    '- Era: ' + (ctx.era || 'unknown') + ', claimed version: ' + (report.claimedVersion || 'none') +
      ', graded against ' + report.version + (report.bestEffort ? ' (best effort)' : ''),
    ...(ctx.era ? [] : ['- **No handshake succeeded**, so the server was not graded: ' + cell(ctx.handshakeError) +
      '. A server that needs a sign-in can be graded with --header "Authorization: Bearer <token>".']),
    '- Verdict: **' + (ctx.era ? report.verdict : 'not graded') + '** (' + Object.keys(report.counts).filter((k) => report.counts[k]).map((k) => report.counts[k] + ' ' + k).join(', ') + ')',
    '', '| Result | Rule | Check | Detail |', '| :--- | :--- | :--- | :--- |',
  ];
  for (const r of report.results) {
    if (r.status === 'not-applicable') continue;
    lines.push('| ' + MARK[r.status] + ' | [' + r.id + '](' + r.specRef + ') | ' + cell(r.title) + ' | ' + cell(r.message) + ' |');
  }
  return lines.join('\n') + '\n';
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) { console.error(args.error + '\n' + USAGE); process.exitCode = 2; return; }
  const allow = [new URL(args.url).origin];
  const ctx = await collectCompliance({ url: args.url, headers: args.headers, send: proxySend(allow, createGuardedFetch({ allow })) });
  const report = runCompliance(COMPLIANCE_CATALOGUE, ctx);
  process.stdout.write(args.json ? JSON.stringify({ url: args.url, era: ctx.era, ...report }, null, 2) + '\n' : markdownReport(args.url, ctx, report));
  process.exitCode = report.verdict === 'fail' || !ctx.era ? 1 : 0;
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
