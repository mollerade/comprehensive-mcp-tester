/**
 * Resources, prompts and pagination rules (#11).
 */
import { RULES_ALL_VERSIONS, rulesSpec, rulesPages, rulesResult, rulesItems, rulesFirst, rulesIsObject } from './helpers.js';

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const PAGED = [['tools/list', 'tools', 'name'], ['resources/list', 'resources', 'uri'], ['prompts/list', 'prompts', 'name']];

function resourceProblem(r, i) {
  if (!rulesIsObject(r)) return 'resource ' + i + ' is not an object';
  if (typeof r.uri !== 'string' || !URI_SCHEME.test(r.uri)) return 'resource ' + (r.name || i) + ': uri ' + JSON.stringify(r.uri) + ' is not a URI';
  if (typeof r.name !== 'string' || !r.name) return 'resource ' + r.uri + ' has no name';
  return null;
}

function promptProblem(p, i) {
  if (!rulesIsObject(p)) return 'prompt ' + i + ' is not an object';
  if (typeof p.name !== 'string' || !p.name) return 'prompt ' + i + ' has no name';
  return promptArgumentsProblem(p);
}

function promptArgumentsProblem(p) {
  if (p.arguments === undefined) return null;
  if (!Array.isArray(p.arguments)) return p.name + ': arguments is not a list';
  for (const a of p.arguments) {
    if (!rulesIsObject(a) || typeof a.name !== 'string') return p.name + ': an argument has no name';
    if (a.required !== undefined && typeof a.required !== 'boolean') return p.name + '.' + a.name + ': required is not true or false';
  }
  return null;
}

/** A list rule that skips when the server did not advertise or serve the list */
function itemsRule(id, title, category, method, key, problemOf, page) {
  return {
    id, title, category, severity: 'fail', appliesTo: RULES_ALL_VERSIONS, specRef: rulesSpec('2025-11-25', page),
    check: function (ctx) {
      const items = rulesItems(ctx, method, key);
      if (!items) return { skip: method + ' was not offered, or did not succeed' };
      return rulesFirst(items.map(problemOf).filter((p) => p), (p) => p);
    },
  };
}

function cursorProblem(method, r, seenCursors) {
  const c = r.nextCursor;
  if (c === undefined) return null;
  if (typeof c !== 'string') return method + ': nextCursor is not a string';
  if (seenCursors[c]) return method + ': the cursor "' + c + '" came back twice, so paging never ends';
  seenCursors[c] = true;
  return null;
}

function repeatedItems(method, list, idKey, seenItems) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const id = rulesIsObject(item) ? item[idKey] : undefined;
    if (id !== undefined && seenItems[id]) out.push(method + ': "' + id + '" appears on more than one page');
    seenItems[id] = true;
  }
  return out;
}

/** Repeated cursors or items across the pages of one list */
function pagingProblems(ctx, method, key, idKey) {
  const pages = rulesPages(ctx, method).map(rulesResult).filter((r) => r);
  const out = [], seenItems = {}, seenCursors = {};
  for (const r of pages) {
    const cp = cursorProblem(method, r, seenCursors);
    if (cp) out.push(cp);
    for (const p of repeatedItems(method, r[key], idKey, seenItems)) out.push(p);
  }
  return out;
}

export const RESOURCE_RULES = [
  itemsRule('MCP-RES-001', 'Every resource has a URI and a name', 'resources', 'resources/list', 'resources', resourceProblem, 'server/resources'),
  itemsRule('MCP-PROMPT-001', 'Every prompt has a name, and its arguments are named', 'prompts', 'prompts/list', 'prompts', promptProblem, 'server/prompts'),
  {
    id: 'MCP-PAGE-001', title: 'Paging moves forward: string cursors, no cursor or item twice', category: 'pagination', severity: 'fail',
    appliesTo: RULES_ALL_VERSIONS, specRef: rulesSpec('2025-11-25', 'server/utilities/pagination'),
    check: function (ctx) {
      const paged = PAGED.filter((p) => rulesPages(ctx, p[0]).length > 1 || (rulesResult(rulesPages(ctx, p[0])[0]) || {}).nextCursor !== undefined);
      if (!paged.length) return { skip: 'no list was paged' };
      const out = [];
      for (const [method, key, idKey] of paged) for (const p of pagingProblems(ctx, method, key, idKey)) out.push(p);
      return rulesFirst(out, (p) => p);
    },
  },
];
