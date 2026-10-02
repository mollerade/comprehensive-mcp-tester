/**
 * One compliance check for a host endpoint (POST /compliance) or the CLI —
 * platform-free. Every probe goes through proxyMcp, so the host's target
 * policy, redirect checks and Accept repair apply exactly as for /proxy.
 *
 *   input  { url, headers? }      headers: credentials for the server, as the UI sends them to /proxy
 *   output { status, json }       json: { summary, report, markdown } or { error, hint? }
 *
 * `env` is proxyMcp's env (fetch, allowTargets, allowAnyPublic, colo) plus an
 * optional `signal`: once it aborts, the remaining probes are not sent, and the
 * answer is 499 { error: 'cancelled' }.
 */
import { proxyMcp } from '../proxy.js';
import { checkTarget } from '../target-policy.js';
import { collectCompliance } from './collect.js';
import { runCompliance } from './engine.js';
import { COMPLIANCE_CATALOGUE } from './catalogue.js';
import { complianceSummary, complianceMarkdown } from './report.js';

export const COMPLIANCE_PROBE_TIMEOUT_MS = 15000;

/** The collector's send(), over the proxy core; never sends once `signal` has aborted */
export function complianceSend(env) {
  return async function (url, init) {
    if (env.signal && env.signal.aborted) return { error: 'cancelled' };
    const r = await proxyMcp({ url, method: init.method, headers: init.headers, body: init.body, purpose: init.purpose,
      timeoutMs: COMPLIANCE_PROBE_TIMEOUT_MS }, env);
    if (r.status !== 200) return { error: r.json.error + (r.json.hint ? ' ' + r.json.hint : '') };
    if (r.json.status === 0) return { error: r.json.diag.errorDetail };
    return { status: r.json.status, headers: r.json.headers, body: r.json.body };
  };
}

/** Only string header values, so a payload cannot smuggle objects into the probes */
function complianceHeaders(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) if (typeof raw[k] === 'string') out[k.toLowerCase()] = raw[k];
  return out;
}

function complianceTargetProblem(url, env) {
  if (typeof url !== 'string' || !url) return { status: 400, json: { error: "Missing 'url' in request" } };
  let parsed;
  try { parsed = new URL(url); } catch { return { status: 400, json: { error: 'Invalid target URL' } }; }
  const policy = { allow: env.allowTargets || env.allowedOrigins || [], allowAnyPublic: env.allowAnyPublic !== false };
  const refusal = checkTarget(parsed, policy);
  return refusal ? { status: 403, json: { error: refusal.error, hint: refusal.hint } } : null;
}

export async function runComplianceCheck(payload, env) {
  payload = payload || {};
  const problem = complianceTargetProblem(payload.url, env);
  if (problem) return problem;
  const ctx = await collectCompliance({ url: payload.url, headers: complianceHeaders(payload.headers), send: complianceSend(env) });
  if (env.signal && env.signal.aborted) return { status: 499, json: { error: 'cancelled' } };
  const report = runCompliance(COMPLIANCE_CATALOGUE, ctx);
  const summary = complianceSummary(ctx);
  return { status: 200, json: { summary, report, markdown: complianceMarkdown(summary, report, { signInHint: typeof payload.signInHint === 'string' ? payload.signInHint : undefined }) } };
}
