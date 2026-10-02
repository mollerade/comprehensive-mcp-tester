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
  { name: 'as-no-s256', protocol: 'legacy', auth: { hint: true, issuerPath: '/as-no-s256', pkceMethods: ['plain'] },
    description: 'Behind an authorization server whose metadata does not offer PKCE S256',
    handler: (ctx) => serveLegacy(ctx) },
  { name: 'as-issuer-mismatch', protocol: 'legacy', auth: { hint: true, issuerPath: '/as-issuer-mismatch', issuerMismatch: true },
    description: 'Behind an authorization server whose metadata issuer has a trailing slash the resource metadata does not (RFC 8414 \u00a73.3)',
    handler: (ctx) => serveLegacy(ctx) },
];
