#!/usr/bin/env node
/**
 * Whether the repository's dependency graph is on, for the Dependency review
 * job: the review action needs the graph and fails outright where a
 * repository owner has switched it off (Settings, then Advanced Security).
 *
 *   node scripts/dependency-graph.mjs
 *
 * Reads GITHUB_REPOSITORY, GITHUB_TOKEN and GITHUB_API_URL as Actions sets
 * them, and writes on=true or on=false to $GITHUB_OUTPUT. When the graph is
 * off it prints a warning annotation and says so in the job summary, so the
 * skipped review is visible. Only a 404 means off: any other API error exits
 * 1, so an outage or a missing permission fails the job instead of skipping
 * the review.
 */
import { appendFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';

export async function dependencyGraphOn({ api, repo, token }) {
  const res = await fetch(api + '/repos/' + repo + '/dependency-graph/sbom', {
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
  });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error('GitHub API answered ' + res.status + ' for the dependency graph of ' + repo);
}

async function main() {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY;
  const on = await dependencyGraphOn({ api: env.GITHUB_API_URL || 'https://api.github.com', repo, token: env.GITHUB_TOKEN });
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'on=' + on + '\n');
  if (on) return console.log('dependency graph on for ' + repo);
  const why = 'the dependency graph is off for ' + repo + ' (Settings, then Advanced Security); npm audit in the test job still checks every dependency';
  console.log('::warning title=Dependency review skipped::' + why);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, 'Dependency review skipped: ' + why + '.\n');
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
