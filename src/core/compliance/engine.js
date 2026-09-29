/**
 * Compliance rule engine — platform-free: no `node:` imports, no Cloudflare or
 * browser globals, no clock, no network. Collection (sending probes) happens
 * elsewhere; this only grades what was recorded, so the same exchanges always
 * give the same results on the Worker, the Node server and in tests.
 *
 * A rule is
 *   { id: 'MCP-<CATEGORY>-<NNN>', title, category, severity: 'fail' | 'warn',
 *     appliesTo: ['2026-07-28', ...], specRef: 'https://...', needsProbe?, check(ctx) }
 * and check(ctx) returns one of
 *   { ok: true }                          pass
 *   { ok: false, message, evidence? }     fail, or warn when the rule's severity is warn
 *   { skip: 'reason' }                    skipped: the recording cannot answer this rule
 * or throws, which grades that rule `error` and leaves every other rule alone.
 *
 * ctx is { claimedVersion, exchanges, probed, ... } as the collector records it.
 */

export const COMPLIANCE_STATUSES = ['pass', 'warn', 'fail', 'error', 'not-applicable', 'skipped'];

/** Every protocol version at least one rule applies to, oldest first */
export function catalogueVersions(catalogue) {
  const seen = {};
  for (const rule of catalogue) for (const v of rule.appliesTo) seen[v] = true;
  return Object.keys(seen).sort();
}

/**
 * Which rules run for a claimed version. A known version runs its own rules;
 * an unknown one runs the newest known set as best effort.
 */
export function selectRules(catalogue, claimedVersion) {
  const known = catalogueVersions(catalogue);
  const bestEffort = known.indexOf(claimedVersion) === -1;
  const version = bestEffort ? known[known.length - 1] : claimedVersion;
  const run = [], notApplicable = [];
  for (const rule of catalogue) (rule.appliesTo.indexOf(version) !== -1 ? run : notApplicable).push(rule);
  return { version, bestEffort, run, notApplicable };
}

function describeRule(rule) {
  return { id: rule.id, title: rule.title, category: rule.category, severity: rule.severity, specRef: rule.specRef };
}

function gradeOutcome(rule, outcome) {
  if (!outcome || outcome === true || outcome.ok === true) return { status: 'pass' };
  if (outcome.skip) return { status: 'skipped', message: String(outcome.skip) };
  const graded = { status: rule.severity === 'warn' ? 'warn' : 'fail', message: outcome.message || 'check failed' };
  if (outcome.evidence !== undefined) graded.evidence = outcome.evidence;
  return graded;
}

/** One rule's result. A throwing check is `error`, never a crash of the run. */
export function evaluateRule(rule, ctx) {
  if (rule.needsProbe && !ctx.probed) return { ...describeRule(rule), status: 'skipped', message: 'needs an active probe run' };
  let outcome;
  try { outcome = rule.check(ctx); }
  catch (e) { return { ...describeRule(rule), status: 'error', message: (e && e.message) || String(e) }; }
  return { ...describeRule(rule), ...gradeOutcome(rule, outcome) };
}

/** pass / warn / fail over all results. An `error` is inconclusive, so it caps the verdict at warn, never pass. */
export function complianceVerdict(results) {
  const has = (s) => results.some((r) => r.status === s);
  if (has('fail')) return 'fail';
  if (has('warn') || has('error')) return 'warn';
  return 'pass';
}

function countStatuses(results) {
  const counts = {};
  for (const s of COMPLIANCE_STATUSES) counts[s] = 0;
  for (const r of results) counts[r.status]++;
  return counts;
}

/** The whole report for one recording. Pure: same catalogue and ctx, same report. */
export function runCompliance(catalogue, ctx) {
  const selection = selectRules(catalogue, ctx.claimedVersion);
  const results = selection.run.map((rule) => {
    const result = evaluateRule(rule, ctx);
    return selection.bestEffort ? { ...result, bestEffort: true } : result;
  });
  for (const rule of selection.notApplicable) results.push({ ...describeRule(rule), status: 'not-applicable' });
  return {
    claimedVersion: ctx.claimedVersion || null,
    version: selection.version,
    bestEffort: selection.bestEffort,
    verdict: complianceVerdict(results),
    counts: countStatuses(results),
    results,
  };
}
