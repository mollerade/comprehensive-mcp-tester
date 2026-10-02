/**
 * Shared by the rule files: version sets, spec links, and lookups over the
 * collector's recording (see ../collect.js). Every name here is prefixed,
 * because the Worker build joins all core files into one script.
 */
import { KNOWN_PROTOCOL_VERSIONS } from './version.js';

/** Every revision the catalogue grades */
export const RULES_ALL_VERSIONS = KNOWN_PROTOCOL_VERSIONS;
/** Streamable HTTP with sessions and the initialize handshake (2024-11-05 used HTTP+SSE, which the tester does not speak) */
export const RULES_SESSION_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25'];
/** Every revision with the initialize handshake */
export const RULES_HANDSHAKE_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
/** The stateless revision */
export const RULES_MODERN_VERSIONS = ['2026-07-28'];
/** Every revision served over Streamable HTTP */
export const RULES_HTTP_VERSIONS = RULES_SESSION_VERSIONS.concat(RULES_MODERN_VERSIONS);

/** A page of the specification, e.g. rulesSpec('2025-11-25', 'basic/transports') */
export function rulesSpec(version, page) {
  return 'https://modelcontextprotocol.io/specification/' + version + '/' + page;
}

export const RULES_NO_ANSWER = { skip: 'the server did not answer this probe' };

/** The recorded exchange with this label, or null */
export function rulesExchange(ctx, label) {
  return (ctx.exchanges || []).find((e) => e.label === label) || null;
}

/** Exchanges the server answered (any HTTP status) */
export function rulesAnswered(ctx) {
  return (ctx.exchanges || []).filter((e) => !e.transportError);
}

/** Answered requests (not notifications) whose response carries a JSON-RPC result or error */
export function rulesResponses(ctx) {
  return rulesAnswered(ctx).filter((e) => e.request.body.id !== undefined && e.response);
}

/** The successful result of an exchange: a 2xx response with a result object, or null */
export function rulesResult(exchange) {
  if (!exchange || exchange.transportError || exchange.status < 200 || exchange.status > 299) return null;
  const r = exchange.response && exchange.response.result;
  return r && typeof r === 'object' ? r : null;
}

/** Every successful result in the recording, with its exchange */
export function rulesResults(ctx) {
  return rulesAnswered(ctx).filter((e) => rulesResult(e)).map((e) => ({ exchange: e, result: rulesResult(e) }));
}

/** The pages of one list method, in order: 'tools/list', 'tools/list page 2', ... */
export function rulesPages(ctx, method) {
  return (ctx.exchanges || []).filter((e) => e.label === method || e.label.indexOf(method + ' page ') === 0);
}

/** The items of a list method across its pages (key: 'tools' / 'resources' / 'prompts'), or null when the list failed */
export function rulesItems(ctx, method, key) {
  const pages = rulesPages(ctx, method);
  if (!pages.length || !rulesResult(pages[0])) return null;
  const items = [];
  for (const page of pages) {
    const list = (rulesResult(page) || {})[key];
    if (Array.isArray(list)) for (const item of list) items.push(item);
  }
  return items;
}

/** Fail with the first offender, or pass: a short way to write most checks */
export function rulesFirst(problems, describe) {
  if (!problems.length) return { ok: true };
  return { ok: false, message: describe(problems[0]) + (problems.length > 1 ? ' (and ' + (problems.length - 1) + ' more)' : ''), evidence: problems.slice(0, 5) };
}

export const rulesIsObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
