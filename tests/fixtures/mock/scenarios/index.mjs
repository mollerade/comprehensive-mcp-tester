/**
 * Scenario registry. Every scenario is { name, description, protocol, handler }
 * plus optional `alias` (a legacy top-level path), `raw` and `auth`.
 *
 *   /scenario/<name>/mcp   any scenario by name
 *   /<alias>               the original paths (/mcp, /slow, ...), unchanged
 *   GET /__scenarios       the list below, as JSON
 */
import { STANDARD } from './standard.mjs';
import { VIOLATIONS } from './violations.mjs';

export const SCENARIOS = [...STANDARD, ...VIOLATIONS];

const byName = new Map(SCENARIOS.map((s) => [s.name, s]));
const byAlias = new Map(SCENARIOS.filter((s) => s.alias).map((s) => [s.alias, s]));
const SCENARIO_PATH = /^\/scenario\/([^/]+)\/mcp$/;

/** The scenario a request path selects: { scenario } for a match, { unknown } for /scenario/<bad>/mcp, null otherwise */
export function resolveScenario(path) {
  const m = SCENARIO_PATH.exec(path);
  if (m) return byName.has(m[1]) ? { scenario: byName.get(m[1]) } : { unknown: m[1] };
  return byAlias.has(path) ? { scenario: byAlias.get(path) } : null;
}

/** The scenario behind an authorization server issuer path such as /as-no-s256 */
export function scenarioForIssuerPath(issuerPath) {
  return SCENARIOS.find((s) => s.auth && s.auth.issuerPath === issuerPath) || null;
}

/** GET /__scenarios body */
export function listScenarios() {
  return SCENARIOS.map((s) => ({
    name: s.name, description: s.description, protocol: s.protocol,
    paths: [...(s.alias ? [s.alias] : []), '/scenario/' + s.name + '/mcp'],
    ...(s.auth ? { auth: true } : {}),
  }));
}
