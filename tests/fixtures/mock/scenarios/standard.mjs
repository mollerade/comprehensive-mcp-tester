/**
 * The mock's original behaviours, one scenario each. `alias` is the path they
 * have always been served on; /scenario/<name>/mcp serves the same behaviour.
 *
 * `raw: true` runs before the Accept check and before the call is recorded,
 * as /hang and /fail always have. `auth` puts the scenario behind the built-in
 * authorization server (see mock-mcp-server.mjs).
 */
import { serveLegacy, serveModern, modernVersionOf, reply, sleep, MODERN_VERSION, LEGACY_VERSION } from '../protocol.mjs';

const SLOW_LIST_TOOLS = [{ name: 'slow_list_tool', description: 'Only served by /slow-list', inputSchema: { type: 'object', properties: {} } }];
const SLOW_LIST_MS = 800;

export const STANDARD = [
  { name: 'mcp', alias: '/mcp', protocol: 'legacy',
    description: 'Normal legacy server: initialize handshake, session required afterwards',
    handler: (ctx) => serveLegacy(ctx) },
  { name: 'slow', alias: '/slow', protocol: 'legacy',
    description: 'Normal, but every response is delayed 400ms',
    handler: async (ctx) => { await sleep(400); return serveLegacy(ctx); } },
  { name: 'hang', alias: '/hang', protocol: 'legacy', raw: true,
    description: 'Never responds (timeouts)',
    handler: () => {} },
  { name: 'fail', alias: '/fail', protocol: 'legacy', raw: true,
    description: 'HTTP 503 on everything',
    handler: (ctx) => reply(ctx.res, 503, { error: 'upstream unavailable' }) },
  { name: 'stream', alias: '/stream', protocol: 'legacy',
    description: 'tools/call answers as text/event-stream instead of JSON',
    handler: (ctx) => serveLegacy(ctx, { streamCalls: true }) },
  { name: 'slow-list', alias: '/slow-list', protocol: 'legacy',
    description: 'tools/list answers after 800ms with its own tool list, so a late answer is recognisable',
    handler: (ctx) => serveLegacy(ctx, { listTools: () => sleep(SLOW_LIST_MS).then(() => SLOW_LIST_TOOLS) }) },
  { name: 'modern', alias: '/modern', protocol: 'modern',
    description: '2026-07-28 only: _meta version and mirrored headers required, 404 -32601 for unknown methods, initialize rejected',
    handler: (ctx) => serveModern(ctx) },
  { name: 'dual', alias: '/dual', protocol: 'dual',
    description: 'Both eras: modern requests served statelessly, initialize gets a session',
    handler: (ctx) => (modernVersionOf(ctx.body)
      ? serveModern(ctx, { supported: [MODERN_VERSION, LEGACY_VERSION] })
      : serveLegacy(ctx)) },
  { name: 'secure', alias: '/secure', protocol: 'legacy', auth: { hint: true },
    description: '401 with WWW-Authenticate resource_metadata + scope; like /mcp once a valid token is presented',
    handler: (ctx) => serveLegacy(ctx) },
  { name: 'secure-nohint', alias: '/secure-nohint', protocol: 'legacy', auth: { hint: false },
    description: '401 without resource_metadata: clients must probe the well-known URLs',
    handler: (ctx) => serveLegacy(ctx) },
  { name: 'secure-mixup', alias: '/secure-mixup', protocol: 'legacy', auth: { hint: true, mixup: true },
    description: 'The authorization server redirects back with a wrong iss (mix-up attack)',
    handler: (ctx) => serveLegacy(ctx) },
  { name: 'paged', protocol: 'legacy',
    description: 'A correct server whose tools/list pages one tool at a time',
    handler: (ctx) => serveLegacy(ctx, { pageSize: 1 }) },
  { name: 'custom-credentials', protocol: 'legacy', auth: { hint: true, issuerPath: '/as-custom-credentials', tokenPath: '/token-custom' },
    description: 'Client credentials with non-standard field names: profileID / secret (bank-profile / bank-secret) at /token-custom',
    handler: (ctx) => serveLegacy(ctx) },
];
