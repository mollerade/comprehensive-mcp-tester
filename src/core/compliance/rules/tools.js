/**
 * Capability and tools rules (#11).
 */
import { RULES_ALL_VERSIONS, RULES_MODERN_VERSIONS, RULES_NO_ANSWER, rulesSpec, rulesExchange, rulesPages, rulesResult, rulesItems, rulesFirst, rulesIsObject } from './helpers.js';
import { schemaProblems } from './json-schema.js';

const TOOLS_SPEC = rulesSpec('2025-11-25', 'server/tools');
const LISTS = [['tools', 'tools/list'], ['resources', 'resources/list'], ['prompts', 'prompts/list']];
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_TYPES = ['string', 'integer', 'boolean', 'number'];
const LIST_FAILED = { skip: 'tools/list did not succeed' };

/** One capability: advertised but its list fails, or listed but not advertised */
function capabilityProblem(ctx, cap, method) {
  const first = rulesPages(ctx, method)[0];
  if (!first || first.transportError) return null;
  const list = (rulesResult(first) || {})[cap];
  const advertised = !!(ctx.capabilities || {})[cap];
  if (advertised && !Array.isArray(list)) return cap + ' is advertised, but ' + method + ' failed (HTTP ' + first.status + ')';
  if (!advertised && Array.isArray(list) && list.length) return method + ' returns ' + cap + ', but the server does not advertise the ' + cap + ' capability';
  return null;
}

function capabilityProblems(ctx) {
  return LISTS.map((l) => capabilityProblem(ctx, l[0], l[1])).filter((p) => p);
}

function toolShapeProblem(t, i) {
  if (!rulesIsObject(t)) return 'tool ' + i + ' is not an object';
  if (typeof t.name !== 'string' || !t.name) return 'tool ' + i + ' has no name';
  if (!rulesIsObject(t.inputSchema)) return t.name + ' has no inputSchema object';
  if (t.inputSchema.type !== 'object') return t.name + ': inputSchema.type is ' + JSON.stringify(t.inputSchema.type) + ', not "object"';
  return null;
}

function toolSchemaProblems(t) {
  const out = [];
  if (!rulesIsObject(t)) return out;
  for (const key of ['inputSchema', 'outputSchema']) {
    if (t[key] === undefined) continue;
    for (const p of schemaProblems(t[key])) out.push(t.name + ' ' + key + ' ' + p);
  }
  return out;
}

/** What is wrong with one property's x-mcp-header, or null; records the name in seen */
function headerAnnotationProblem(ps, seen) {
  const hn = ps['x-mcp-header'];
  if (hn === undefined) return null;
  if (typeof hn !== 'string' || !HEADER_TOKEN.test(hn)) return 'x-mcp-header ' + JSON.stringify(hn) + ' is not a valid header name';
  const key = hn.toLowerCase();
  if (seen[key]) return 'x-mcp-header "' + hn + '" is used twice';
  seen[key] = true;
  if (HEADER_TYPES.indexOf(ps.type) === -1) return 'x-mcp-header on a ' + JSON.stringify(ps.type) + ' property; only primitives are mirrored';
  return null;
}

/** x-mcp-header annotations along plain properties chains, as the client mirrors them */
function headerProblems(tool, schema, path, seen, out) {
  const props = rulesIsObject(schema) && rulesIsObject(schema.properties) ? schema.properties : {};
  for (const name of Object.keys(props)) {
    const ps = props[name] || {}, at = path + name;
    const p = headerAnnotationProblem(ps, seen);
    if (p) out.push(tool + '.' + at + ': ' + p);
    headerProblems(tool, ps, at + '.', seen, out);
  }
}

const toolNames = (ctx, label) => ((rulesResult(rulesExchange(ctx, label)) || {}).tools || []).map((t) => (t && t.name) || '');

function toolsRule(id, title, severity, appliesTo, problemsOf) {
  return {
    id, title, category: 'tools', severity, appliesTo, specRef: id === 'MCP-TOOL-004' ? rulesSpec('2026-07-28', 'server/tools') : TOOLS_SPEC,
    check: function (ctx) {
      const tools = rulesItems(ctx, 'tools/list', 'tools');
      if (!tools) return LIST_FAILED;
      return rulesFirst(problemsOf(tools), (p) => p);
    },
  };
}

export const TOOL_RULES = [
  {
    id: 'MCP-CAP-001', title: 'Advertised capabilities work, and served features are advertised', category: 'capabilities', severity: 'fail',
    appliesTo: RULES_ALL_VERSIONS, specRef: rulesSpec('2025-11-25', 'basic/lifecycle'),
    check: function (ctx) {
      if (!rulesPages(ctx, 'tools/list').length) return RULES_NO_ANSWER;
      return rulesFirst(capabilityProblems(ctx), (p) => p);
    },
  },
  toolsRule('MCP-TOOL-001', 'Every tool has a name and an object inputSchema', 'fail', RULES_ALL_VERSIONS,
    (tools) => tools.map(toolShapeProblem).filter((p) => p)),
  toolsRule('MCP-TOOL-002', 'Tool names are unique and use the recommended characters', 'warn', RULES_ALL_VERSIONS, (tools) => {
    const seen = {}, out = [];
    for (const t of tools) {
      const n = t && t.name;
      if (typeof n !== 'string') continue;
      if (seen[n]) out.push('tool name "' + n + '" appears twice');
      else if (!TOOL_NAME.test(n)) out.push('tool name "' + n + '" uses characters outside A-Z a-z 0-9 _ - . or is over 128 characters');
      seen[n] = true;
    }
    return out;
  }),
  toolsRule('MCP-TOOL-003', 'Tool schemas are valid JSON Schema 2020-12 with resolvable $refs', 'fail', RULES_ALL_VERSIONS,
    (tools) => [].concat.apply([], tools.map(toolSchemaProblems))),
  toolsRule('MCP-TOOL-004', 'x-mcp-header annotations are valid, unique header names on primitive properties', 'fail', RULES_MODERN_VERSIONS, (tools) => {
    const out = [];
    for (const t of tools) if (rulesIsObject(t)) headerProblems(t.name, t.inputSchema, '', {}, out);
    return out;
  }),
  {
    id: 'MCP-TOOL-005', title: 'tools/list returns the same order every time', category: 'tools', severity: 'warn',
    appliesTo: RULES_MODERN_VERSIONS, specRef: rulesSpec('2026-07-28', 'server/tools'),
    check: function (ctx) {
      if (!rulesResult(rulesExchange(ctx, 'tools/list')) || !rulesResult(rulesExchange(ctx, 'tools/list (repeat)'))) return LIST_FAILED;
      const a = toolNames(ctx, 'tools/list').join(', '), b = toolNames(ctx, 'tools/list (repeat)').join(', ');
      return a === b ? { ok: true } : { ok: false, message: 'two calls listed the tools in different orders', evidence: { first: a, second: b } };
    },
  },
];
