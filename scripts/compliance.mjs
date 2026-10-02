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
 * be graded, and public hosts are allowed for the authorization server; any
 * other special-purpose address, and every redirect hop, is still checked. Prints a Markdown
 * report (or the report as JSON). Exit code: 0 pass or warn, 1 a failing rule or
 * nothing graded at all, 2 usage. A server that asks for a sign-in has its
 * authorization discovery graded; --header with a token grades the rest.
 * Headers are sent to the target only, and never printed.
 */
import { createGuardedFetch } from '../src/hosts/guarded-fetch.js';
import { collectCompliance } from '../src/core/compliance/collect.js';
import { runCompliance } from '../src/core/compliance/engine.js';
import { COMPLIANCE_CATALOGUE } from '../src/core/compliance/catalogue.js';
import { complianceSend } from '../src/core/compliance/run.js';
import { complianceSummary, complianceMarkdown } from '../src/core/compliance/report.js';
import { isMain } from './is-main.mjs';

const USAGE = 'usage: npm run compliance -- <server url> [--header "Name: value"]... [--json]';
const SIGN_IN_HINT = 'Grade the rest with --header "Authorization: Bearer <token>".';

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

/** The proxy env for one target: its own origin listed, public hosts (the authorization server) allowed */
export function cliEnv(url, doFetch) {
  const allow = [new URL(url).origin];
  return { fetch: doFetch || createGuardedFetch({ allow }), allowTargets: allow, allowAnyPublic: true, colo: 'cli' };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) { console.error(args.error + '\n' + USAGE); process.exitCode = 2; return; }
  const ctx = await collectCompliance({ url: args.url, headers: args.headers, send: complianceSend(cliEnv(args.url)) });
  const report = runCompliance(COMPLIANCE_CATALOGUE, ctx);
  const summary = complianceSummary(ctx);
  process.stdout.write(args.json ? JSON.stringify({ summary, ...report }, null, 2) + '\n' : complianceMarkdown(summary, report, { signInHint: SIGN_IN_HINT }));
  process.exitCode = report.verdict === 'fail' || !summary.graded ? 1 : 0;
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
