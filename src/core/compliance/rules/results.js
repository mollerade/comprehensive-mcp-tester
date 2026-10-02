/**
 * Result rules of the stateless era (#10, #11): what every result, and every
 * list result, carries in 2026-07-28.
 */
import { RULES_MODERN_VERSIONS, RULES_NO_ANSWER, rulesSpec, rulesResults, rulesFirst, rulesIsObject } from './helpers.js';
import { COMPLIANCE_META } from '../collect.js';

const RESULTS_SPEC = rulesSpec('2026-07-28', 'basic');
const isListLabel = (label) => /^(tools|resources|prompts)\/list( page \d+)?$/.test(label);

function everyResult(ctx, problemOf, describe) {
  const results = rulesResults(ctx);
  if (!results.length) return RULES_NO_ANSWER;
  const problems = [];
  for (const x of results) {
    const p = problemOf(x.result, x.exchange);
    if (p) problems.push(Object.assign({ probe: x.exchange.label }, p));
  }
  return rulesFirst(problems, describe);
}

export const RESULT_RULES = [
  {
    id: 'MCP-RESULT-001', title: 'Every result says its resultType', category: 'results', severity: 'fail',
    appliesTo: RULES_MODERN_VERSIONS, specRef: RESULTS_SPEC,
    check: function (ctx) {
      return everyResult(ctx, (r) => (typeof r.resultType === 'string' ? null : { resultType: r.resultType }),
        (p) => p.probe + ': the result has no resultType');
    },
  },
  {
    id: 'MCP-RESULT-002', title: 'List results carry ttlMs and cacheScope', category: 'results', severity: 'warn',
    appliesTo: RULES_MODERN_VERSIONS, specRef: RESULTS_SPEC,
    check: function (ctx) {
      return everyResult(ctx, (r, e) => {
        if (!isListLabel(e.label)) return null;
        const ttlOk = typeof r.ttlMs === 'number' && r.ttlMs >= 0;
        return ttlOk && typeof r.cacheScope === 'string' ? null : { ttlMs: r.ttlMs, cacheScope: r.cacheScope };
      }, (p) => p.probe + ': ttlMs ' + JSON.stringify(p.ttlMs) + ', cacheScope ' + JSON.stringify(p.cacheScope));
    },
  },
  {
    id: 'MCP-META-001', title: 'Every result names the server in _meta', category: 'results', severity: 'warn',
    appliesTo: RULES_MODERN_VERSIONS, specRef: RESULTS_SPEC,
    check: function (ctx) {
      return everyResult(ctx, (r) => {
        const info = rulesIsObject(r._meta) ? r._meta[COMPLIANCE_META + 'serverInfo'] : null;
        return rulesIsObject(info) && typeof info.name === 'string' ? null : { meta: r._meta };
      }, (p) => p.probe + ': no ' + COMPLIANCE_META + 'serverInfo in the result _meta');
    },
  },
];
