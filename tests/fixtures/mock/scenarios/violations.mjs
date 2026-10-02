/**
 * Deterministic spec violations, served only on /scenario/<name>/mcp. Each one
 * breaks exactly one rule and is otherwise a correct server, so a compliance
 * check that flags it is flagging the right thing.
 */
import { serveLegacy, serveModern, TOOLS } from '../protocol.mjs';

/** A ctx whose every JSON response passes through `rewrite` first */
function rewriting(ctx, rewrite) {
  return { ...ctx, reply: (status, obj, headers) => ctx.reply(status, obj === undefined ? obj : rewrite(obj), headers) };
}

/** A ctx whose 2xx JSON responses are labelled text/html, as some gateways do */
function htmlLabelled(ctx) {
  return { ...ctx, reply: (status, obj, headers) => ctx.reply(status, obj, status < 300 && obj !== undefined ? { ...headers, 'Content-Type': 'text/html' } : headers) };
}

/** A result rewritten in place by `edit`; errors and notifications pass through */
const editResult = (edit) => (o) => (o && o.result ? { ...o, result: edit({ ...o.result }) } : o);
const without = (...keys) => (r) => { for (const k of keys) delete r[k]; return r; };

const UNNAMED_TOOL = { name: 'no_schema_tool', description: 'Has no inputSchema' };
const HEADER_TOOL = {
  name: 'bad_header_tool', description: 'Its x-mcp-header annotations are invalid',
  inputSchema: { type: 'object', properties: {
    a: { type: 'string', 'x-mcp-header': 'Bad Header' },
    b: { type: 'object', 'x-mcp-header': 'Shape' },
    c: { type: 'string', 'x-mcp-header': 'region' }, d: { type: 'string', 'x-mcp-header': 'Region' },
  } },
};
let shuffleCalls = 0;

const shiftId = (id) => (typeof id === 'number' ? id + 1000 : String(id) + '-mismatch');

const BAD_SCHEMA_TOOL = {
  name: 'bad_schema_tool',
  description: 'Its inputSchema is not valid JSON Schema 2020-12',
  inputSchema: { type: 'objekt', properties: { ref: { $ref: '#/$defs/missing' } }, required: 'ref' },
};

export const VIOLATIONS = [
  { name: 'wrong-jsonrpc-version', protocol: 'legacy',
    description: 'Every response carries "jsonrpc":"1.0"; otherwise valid',
    handler: (ctx) => serveLegacy(rewriting(ctx, (o) => ({ ...o, jsonrpc: '1.0' }))) },
  { name: 'id-mismatch', protocol: 'legacy',
    description: 'Every response id differs from the request id',
    handler: (ctx) => serveLegacy(rewriting(ctx, (o) => (o.id == null ? o : { ...o, id: shiftId(o.id) }))) },
  { name: 'unknown-method-200', protocol: 'modern',
    description: 'An unknown method gets HTTP 200 instead of 404 (still JSON-RPC -32601)',
    handler: (ctx) => serveModern(ctx, { unknownMethodStatus: 200 }) },
  { name: 'notification-200-body', protocol: 'legacy',
    description: 'Notifications get HTTP 200 with a JSON-RPC body instead of 202 and no body',
    handler: (ctx) => serveLegacy(ctx, { notificationBody: true }) },
  { name: 'session-ignored', protocol: 'legacy',
    description: 'Issues an mcp-session-id on initialize but accepts requests without one, or with an unknown one',
    handler: (ctx) => serveLegacy(ctx, { ignoreSession: true }) },
  { name: 'bad-input-schema', protocol: 'legacy',
    description: 'tools/list includes a tool whose inputSchema is invalid (bad type, unresolvable $ref)',
    handler: (ctx) => serveLegacy(ctx, { tools: [...TOOLS, BAD_SCHEMA_TOOL] }) },
  { name: 'result-and-error', protocol: 'legacy',
    description: 'Every successful response carries both a result and an error',
    handler: (ctx) => serveLegacy(rewriting(ctx, (o) => (o && o.result ? { ...o, error: { code: -32603, message: 'also failed' } } : o))) },
  { name: 'unknown-method-result', protocol: 'legacy',
    description: 'An unknown method gets an empty result instead of error -32601',
    handler: (ctx) => serveLegacy(rewriting(ctx, (o) => (o && o.error && o.error.code === -32601 ? { jsonrpc: '2.0', id: o.id, result: {} } : o))) },
  { name: 'wrong-content-type', protocol: 'legacy',
    description: 'Successful JSON responses are labelled Content-Type: text/html',
    handler: (ctx) => serveLegacy(htmlLabelled(ctx)) },
  { name: 'init-missing-serverinfo', protocol: 'legacy',
    description: 'The initialize result has no serverInfo',
    handler: (ctx) => serveLegacy(ctx, { initResult: without('serverInfo') }) },
  { name: 'capability-list-fails', protocol: 'legacy',
    description: 'Advertises the prompts capability, but prompts/list is -32601',
    handler: (ctx) => serveLegacy(ctx, { noPrompts: true }) },
  { name: 'malformed-tool', protocol: 'legacy',
    description: 'tools/list includes a tool without an inputSchema',
    handler: (ctx) => serveLegacy(ctx, { tools: [...TOOLS, UNNAMED_TOOL] }) },
  { name: 'duplicate-tool-names', protocol: 'legacy',
    description: 'tools/list lists the same tool name twice',
    handler: (ctx) => serveLegacy(ctx, { tools: [...TOOLS, TOOLS[0]] }) },
  { name: 'bad-resource', protocol: 'legacy',
    description: 'resources/list includes a resource without a uri',
    handler: (ctx) => serveLegacy(ctx, { resources: [{ name: 'No uri' }] }) },
  { name: 'bad-prompt', protocol: 'legacy',
    description: 'prompts/list includes a prompt whose argument has no name and a non-boolean required',
    handler: (ctx) => serveLegacy(ctx, { prompts: [{ name: 'broken', arguments: [{ required: 'yes' }] }] }) },
  { name: 'cursor-loop', protocol: 'legacy',
    description: 'tools/list pages, but nextCursor never advances, so the same page comes back',
    handler: (ctx) => serveLegacy(ctx, { pageSize: 1, cursorLoop: true }) },
  { name: 'header-mismatch-ignored', protocol: 'modern',
    description: 'Accepts requests whose Mcp-Method header contradicts the body',
    handler: (ctx) => serveModern(ctx, { ignoreHeaders: true }) },
  { name: 'bogus-version-accepted', protocol: 'modern',
    description: 'Accepts any protocol version in _meta instead of answering 400 -32022',
    handler: (ctx) => serveModern(ctx, { anyVersion: true }) },
  { name: 'discover-malformed', protocol: 'modern',
    description: 'server/discover has no supportedVersions',
    handler: (ctx) => serveModern(rewriting(ctx, editResult((r) => (r.supportedVersions ? without('supportedVersions')(r) : r)))) },
  { name: 'no-result-type', protocol: 'modern',
    description: 'Results carry no resultType',
    handler: (ctx) => serveModern(rewriting(ctx, editResult(without('resultType')))) },
  { name: 'no-cache-hints', protocol: 'modern',
    description: 'List results carry no ttlMs or cacheScope',
    handler: (ctx) => serveModern(rewriting(ctx, editResult(without('ttlMs', 'cacheScope')))) },
  { name: 'no-server-info', protocol: 'modern',
    description: 'Results carry no serverInfo in _meta',
    handler: (ctx) => serveModern(rewriting(ctx, editResult(without('_meta')))) },
  { name: 'bad-mcp-header', protocol: 'modern',
    description: 'A tool has invalid x-mcp-header annotations: a space, a non-primitive property, a case-insensitive duplicate',
    handler: (ctx) => serveModern(ctx, { tools: [...TOOLS, HEADER_TOOL] }) },
  { name: 'shuffled-tools', protocol: 'modern',
    description: 'tools/list returns the tools in a different order on every call',
    handler: (ctx) => serveModern(ctx, { listTools: () => (shuffleCalls++ % 2 ? [...TOOLS].reverse() : TOOLS) }) },
  { name: 'as-no-s256', protocol: 'legacy', auth: { hint: true, issuerPath: '/as-no-s256', pkceMethods: ['plain'] },
    description: 'Behind an authorization server whose metadata does not offer PKCE S256',
    handler: (ctx) => serveLegacy(ctx) },
  { name: 'as-issuer-mismatch', protocol: 'legacy', auth: { hint: true, issuerPath: '/as-issuer-mismatch', issuerMismatch: true },
    description: 'Behind an authorization server whose metadata issuer has a trailing slash the resource metadata does not (RFC 8414 \u00a73.3)',
    handler: (ctx) => serveLegacy(ctx) },
];
