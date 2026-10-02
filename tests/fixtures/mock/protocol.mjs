/**
 * MCP server behaviour shared by the mock's scenarios: the tool, resource and
 * prompt catalogue, JSON-RPC helpers, and one strict server per protocol era.
 *
 * A scenario gets a `ctx` ({ req, res, body, sessions, reply, sse }) and either
 * answers itself or delegates to serveLegacy() / serveModern() with options
 * that bend one behaviour. Replacing ctx.reply is how a scenario rewrites
 * every response it sends.
 */
import { randomUUID } from 'node:crypto';

export const TOOLS = [
  {
    name: 'list_account_information_apis',
    description: 'List account information API specifications',
    inputSchema: {
      type: 'object',
      required: ['category'],
      properties: {
        category: { type: 'string', description: 'The API category to list.', 'x-mcp-header': 'Category' },
        api: { type: 'string', description: 'Optional stable API key filter.' },
        mode: { type: 'string', enum: ['summary', 'full'] },
        limit: { type: 'integer', default: 20, description: 'Maximum number of results.' },
      },
    },
  },
  {
    name: 'get_api_details',
    description: 'Fetch full detail for one API product by id',
    inputSchema: { type: 'object', required: ['api_id'], properties: { api_id: { type: 'string' } } },
  },
  {
    name: 'list_payment_apis',
    description: 'List payment initiation API specifications',
    inputSchema: { type: 'object', properties: {} },
  },
];

export const RESOURCES = [{ uri: 'docs://getting-started', name: 'Getting started', mimeType: 'text/markdown' }];
export const PROMPTS = [{ name: 'summarise_api', description: 'Summarise an API', arguments: [{ name: 'api_id', required: true }] }];

export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSION = '2025-11-25';
export const META = 'io.modelcontextprotocol/';
export const SERVER_INFO = { name: 'mock-mcp', version: '1.0.0' };

export function reply(res, status, obj, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}));
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
export const rpcErr = (id, code, message, data) => ({ jsonrpc: '2.0', error: data ? { code, message, data } : { code, message }, id: id ?? null });
export const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** tools/call, resources/read, prompts/get: same answers in both eras */
function answer(body, tools) {
  const p = body.params || {};
  if (body.method === 'resources/read') return { result: { contents: [{ uri: p.uri, mimeType: 'text/markdown', text: '# Getting started' }] } };
  if (body.method === 'prompts/get') return { result: { messages: [{ role: 'user', content: { type: 'text', text: 'Summarise ' + (p.arguments || {}).api_id } }] } };
  const tool = tools.find((t) => t.name === p.name);
  if (!tool) return { error: { code: -32602, message: 'Unknown tool' } };
  const args = p.arguments || {};
  const missing = ((tool.inputSchema || {}).required || []).filter((k) => !(k in args));
  if (missing.length) return { error: { code: -32602, message: 'Missing required argument: ' + missing.join(', ') } };
  return { result: { content: [{ type: 'text', text: 'ok: ' + JSON.stringify(args) }] } };
}

/**
 * tools/list, paged when o.pageSize is set: the cursor is the next offset as a string.
 * o.cursorLoop hands back the first page's cursor forever, a real-world paging bug.
 */
async function toolsPage(body, o) {
  const all = o.listTools ? await o.listTools() : (o.tools || TOOLS);
  if (!o.pageSize) return { tools: all };
  const start = Number((body.params || {}).cursor || 0);
  const page = { tools: all.slice(start, start + o.pageSize) };
  if (start + o.pageSize < all.length) page.nextCursor = o.cursorLoop ? String(o.pageSize) : String(start + o.pageSize);
  return page;
}

const NOT_FOUND = { error: { code: -32601, message: 'Method not found' } };
const ANSWERS = {
  'tools/list': async (body, o) => ({ result: await toolsPage(body, o) }),
  'resources/list': (body, o) => ({ result: { resources: o.resources || RESOURCES } }),
  'prompts/list': (body, o) => (o.noPrompts ? NOT_FOUND : { result: { prompts: o.prompts || PROMPTS } }),
  'tools/call': (body, o) => answer(body, o.tools || TOOLS),
  'resources/read': (body, o) => answer(body, o.tools || TOOLS),
  'prompts/get': (body, o) => answer(body, o.tools || TOOLS),
};

/** The answer to any request method, as { result } or { error }. `o.listTools` may be async. */
async function resultFor(body, o) {
  const handler = Object.hasOwn(ANSWERS, body.method) ? ANSWERS[body.method] : null;
  return handler ? handler(body, o) : NOT_FOUND;
}

/** Streamable HTTP: no session id is 400; one the server does not know (expired, terminated) is 404 */
function sessionRejection(ctx) {
  const sid = ctx.req.headers['mcp-session-id'];
  if (!sid) return [400, rpcErr(null, -32000, 'Bad Request: No valid session ID provided')];
  if (!ctx.sessions.has(sid)) return [404, rpcErr(null, -32001, 'Session not found')];
  return null;
}

/**
 * Legacy era (2025-11-25 and earlier): initialize issues an mcp-session-id that
 * every later request must carry (400 otherwise); notifications get 202 and no body.
 * Options: tools, listTools, streamCalls, ignoreSession, notificationBody, pageSize,
 * cursorLoop, resources, prompts, noPrompts, initResult (rewrites the initialize result).
 */
function legacyInitialize(ctx, o) {
  const sid = randomUUID();
  ctx.sessions.add(sid);
  const result = { protocolVersion: '2025-03-26', serverInfo: SERVER_INFO, capabilities: { tools: {}, resources: {}, prompts: {} } };
  return ctx.reply(200, rpcOk(ctx.body.id, o.initResult ? o.initResult(result) : result), { 'mcp-session-id': sid });
}

export async function serveLegacy(ctx, o = {}) {
  const { body } = ctx;
  if (body.method === 'initialize') return legacyInitialize(ctx, o);
  const rejected = !o.ignoreSession && sessionRejection(ctx);
  if (rejected) return ctx.reply(rejected[0], rejected[1]);
  if (body.id === undefined) return o.notificationBody ? ctx.reply(200, rpcOk(null, {})) : ctx.reply(202, undefined);

  const r = await resultFor(body, o);
  if (r.error) return ctx.reply(200, rpcErr(body.id, r.error.code, r.error.message));
  if (o.streamCalls && body.method === 'tools/call') return ctx.sse(200, rpcOk(body.id, r.result));
  return ctx.reply(200, rpcOk(body.id, r.result));
}

function decodeHeader(v) {
  const m = /^=\?base64\?(.*)\?=$/.exec(v || '');
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
}

function paramHeaderMismatch(headers, p) {
  const tool = TOOLS.find((t) => t.name === p.name);
  for (const [k, ps] of Object.entries((tool && tool.inputSchema.properties) || {})) {
    const hn = ps['x-mcp-header'];
    const v = (p.arguments || {})[k];
    if (!hn) continue;
    const got = headers['mcp-param-' + hn.toLowerCase()];
    if (v == null ? got !== undefined : decodeHeader(got) !== String(v)) return 'Mcp-Param-' + hn + ' header does not match argument';
  }
  return null;
}

/** Header/body validation for a modern request; returns an error message or null */
function headerMismatch(headers, body) {
  const p = body.params || {};
  const version = (p._meta || {})[META + 'protocolVersion'];
  if (headers['mcp-protocol-version'] !== version) return 'MCP-Protocol-Version header does not match _meta';
  if (headers['mcp-method'] !== body.method) return 'Mcp-Method header does not match body method';
  const named = { 'tools/call': p.name, 'prompts/get': p.name, 'resources/read': p.uri };
  if (body.method in named && decodeHeader(headers['mcp-name']) !== String(named[body.method])) return 'Mcp-Name header does not match body';
  return body.method === 'tools/call' ? paramHeaderMismatch(headers, p) : null;
}

export const modernVersionOf = (body) => ((body.params || {})._meta || {})[META + 'protocolVersion'];

/** Rejections a modern server makes before looking at the method, or null. o.ignoreHeaders / o.anyVersion bend them. */
function modernRejection(ctx, supported, o) {
  const { body } = ctx;
  const version = modernVersionOf(body);
  if (body.method === 'initialize') {
    return [400, rpcErr(body.id, -32022, 'Unsupported protocol version: this server speaks ' + MODERN_VERSION + ' only',
      { supported: [MODERN_VERSION], requested: (body.params || {}).protocolVersion })];
  }
  if (!version) return [400, rpcErr(body.id, -32020, 'Missing io.modelcontextprotocol/protocolVersion in _meta')];
  const mismatch = !o.ignoreHeaders && headerMismatch(ctx.req.headers, body);
  if (mismatch) return [400, rpcErr(body.id, -32020, 'Header mismatch: ' + mismatch)];
  if (version !== MODERN_VERSION && !o.anyVersion) return [400, rpcErr(body.id, -32022, 'Unsupported protocol version', { supported, requested: version })];
  return null;
}

/**
 * 2026-07-28 era: stateless. Version, identity and capabilities ride in every
 * request's _meta and must match the mirrored headers (400 -32020); another
 * version is 400 -32022 with the supported list; an unknown method is 404 -32601.
 * Options: supported (versions), unknownMethodStatus, ignoreHeaders, anyVersion, and those of
 * resultFor (tools, listTools, pageSize, cursorLoop, ...).
 */
export async function serveModern(ctx, o = {}) {
  const { body } = ctx;
  const supported = o.supported || [MODERN_VERSION];
  const rejected = modernRejection(ctx, supported, o);
  if (rejected) return ctx.reply(rejected[0], rejected[1]);
  if (body.id === undefined) return ctx.reply(202, undefined);

  const cache = { ttlMs: 60000, cacheScope: 'public' };
  const ok = (result) => ctx.reply(200, rpcOk(body.id, { resultType: 'complete', ...result, _meta: { [META + 'serverInfo']: SERVER_INFO } }));
  if (body.method === 'server/discover') {
    return ok({ supportedVersions: supported, capabilities: { tools: {}, resources: {}, prompts: {} }, ...cache });
  }
  const r = await resultFor(body, o);
  if (!r.error) return ok(/\/list$/.test(body.method) ? { ...r.result, ...cache } : r.result);
  const status = r.error.code === -32601 ? (o.unknownMethodStatus || 404) : 200;
  return ctx.reply(status, rpcErr(body.id, r.error.code, r.error.message));
}
