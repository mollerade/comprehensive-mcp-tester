/**
 * Lifecycle rules (#10): the handshake that opens a connection, in each era,
 * and the version negotiation of the stateless era.
 */
import { RULES_HANDSHAKE_VERSIONS, RULES_MODERN_VERSIONS, RULES_NO_ANSWER, rulesSpec, rulesExchange, rulesResult, rulesIsObject } from './helpers.js';

/** What is missing or wrong in an initialize result */
function initializeProblems(r) {
  const problems = [];
  if (typeof r.protocolVersion !== 'string') problems.push('protocolVersion is missing');
  if (!rulesIsObject(r.capabilities)) problems.push('capabilities is not an object');
  const info = r.serverInfo;
  if (!rulesIsObject(info) || typeof info.name !== 'string' || typeof info.version !== 'string') problems.push('serverInfo needs a string name and version');
  return problems;
}

function discoverProblems(r, claimed) {
  const problems = [];
  const v = r.supportedVersions;
  if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string')) problems.push('supportedVersions is not a non-empty list of versions');
  else if (claimed && v.indexOf(claimed) === -1) problems.push('supportedVersions does not include ' + claimed);
  if (!rulesIsObject(r.capabilities)) problems.push('capabilities is not an object');
  return problems;
}

/** A pass, or a fail listing every problem the handshake result has */
function lifecycleVerdict(label, exchange, problemsOf) {
  if (!exchange || exchange.transportError) return RULES_NO_ANSWER;
  const r = rulesResult(exchange);
  if (!r) return { ok: false, message: label + ' did not succeed (HTTP ' + exchange.status + ')', evidence: exchange.response };
  const problems = problemsOf(r);
  return problems.length ? { ok: false, message: label + ': ' + problems.join('; '), evidence: r } : { ok: true };
}

const unsupportedProblem = (e) => {
  const err = e.response && e.response.error;
  if (e.status !== 400) return 'HTTP ' + e.status + ', expected 400';
  if (!err || err.code !== -32022) return 'error ' + JSON.stringify(err && err.code) + ', expected -32022';
  const supported = err.data && err.data.supported;
  if (!Array.isArray(supported) || !supported.length) return 'error.data.supported does not list the versions the server speaks';
  return null;
};

export const LIFECYCLE_RULES = [
  {
    id: 'MCP-LIFE-001', title: 'The initialize result names the version, the capabilities and the server', category: 'lifecycle', severity: 'fail',
    appliesTo: RULES_HANDSHAKE_VERSIONS, specRef: rulesSpec('2025-11-25', 'basic/lifecycle'),
    check: function (ctx) { return lifecycleVerdict('initialize', rulesExchange(ctx, 'initialize'), initializeProblems); },
  },
  {
    id: 'MCP-LIFE-002', title: 'server/discover lists the supported versions and the capabilities', category: 'lifecycle', severity: 'fail',
    appliesTo: RULES_MODERN_VERSIONS, specRef: rulesSpec('2026-07-28', 'basic/lifecycle'),
    check: function (ctx) {
      if (ctx.era !== 'modern') return { skip: 'the server did not speak the stateless protocol' };
      return lifecycleVerdict('server/discover', rulesExchange(ctx, 'discover'), (r) => discoverProblems(r, ctx.claimedVersion));
    },
  },
  {
    id: 'MCP-VER-002', title: 'An unsupported protocol version is refused with HTTP 400, error -32022 and the supported versions', category: 'version', severity: 'fail',
    appliesTo: RULES_MODERN_VERSIONS, specRef: rulesSpec('2026-07-28', 'basic/lifecycle'),
    check: function (ctx) {
      const e = rulesExchange(ctx, 'unsupported version');
      if (!e || e.transportError) return RULES_NO_ANSWER;
      const problem = unsupportedProblem(e);
      return problem ? { ok: false, message: 'a request for protocol version 1999-01-01 got ' + problem, evidence: { status: e.status, response: e.response } } : { ok: true };
    },
  },
];
