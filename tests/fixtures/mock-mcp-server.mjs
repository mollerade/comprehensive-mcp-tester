/**
 * Mock MCP server (Streamable HTTP) for tests and demos.
 *
 *   npm run mock     → http://127.0.0.1:8788/mcp
 *
 * Behaves like a strict real server:
 *   - rejects requests that don't accept BOTH application/json and text/event-stream (406)
 *   - issues an mcp-session-id on initialize and requires it afterwards (400 otherwise)
 *   - answers notifications with 202 and no body
 *   - validates required tool arguments (JSON-RPC -32602)
 *
 * Paths select behaviour, so diagnostics can be exercised on demand:
 *   /mcp         normal
 *   /slow        normal, but every response is delayed 400ms
 *   /hang        never responds (timeouts)
 *   /fail        HTTP 503 on everything
 *   /stream      tools/call answers as text/event-stream instead of JSON
 *
 * Those are all legacy-era (initialize handshake, sessions), like most servers today.
 * Two more speak the 2026-07-28 stateless protocol:
 *   /modern      2026-07-28 only. Requires _meta protocol version plus matching
 *                MCP-Protocol-Version / Mcp-Method / Mcp-Name / Mcp-Param-* headers
 *                (400 -32020), rejects other versions (400 -32022), 404 -32601 for
 *                unknown methods, and rejects initialize.
 *   /dual        both: modern requests are served statelessly, initialize gets a session.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

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

const RESOURCES = [{ uri: 'docs://getting-started', name: 'Getting started', mimeType: 'text/markdown' }];
const PROMPTS = [{ name: 'summarise_api', description: 'Summarise an API', arguments: [{ name: 'api_id', required: true }] }];

/** tools/call, resources/read, prompts/get: same answers in both eras */
function answer(body) {
  const p = body.params || {};
  if (body.method === 'resources/read') return { result: { contents: [{ uri: p.uri, mimeType: 'text/markdown', text: '# Getting started' }] } };
  if (body.method === 'prompts/get') return { result: { messages: [{ role: 'user', content: { type: 'text', text: 'Summarise ' + (p.arguments || {}).api_id } }] } };
  const tool = TOOLS.find((t) => t.name === p.name);
  if (!tool) return { error: { code: -32602, message: 'Unknown tool' } };
  const args = p.arguments || {};
  const missing = (tool.inputSchema.required || []).filter((k) => !(k in args));
  if (missing.length) return { error: { code: -32602, message: 'Missing required argument: ' + missing.join(', ') } };
  return { result: { content: [{ type: 'text', text: 'ok: ' + JSON.stringify(args) }] } };
}

function reply(res, status, obj, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}));
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
const rpcErr = (id, code, message, data) => ({ jsonrpc: '2.0', error: data ? { code, message, data } : { code, message }, id: id ?? null });
const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });

export const MODERN_VERSION = '2026-07-28';
const META = 'io.modelcontextprotocol/';
const SERVER_INFO = { name: 'mock-mcp', version: '1.0.0' };

function decodeHeader(v) {
  const m = /^=\?base64\?(.*)\?=$/.exec(v || '');
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
}

/** Header/body validation for a modern request; returns an error message or null */
function headerMismatch(headers, body) {
  const p = body.params || {};
  const version = (p._meta || {})[META + 'protocolVersion'];
  if (headers['mcp-protocol-version'] !== version) return 'MCP-Protocol-Version header does not match _meta';
  if (headers['mcp-method'] !== body.method) return 'Mcp-Method header does not match body method';
  const named = { 'tools/call': p.name, 'prompts/get': p.name, 'resources/read': p.uri };
  if (body.method in named && decodeHeader(headers['mcp-name']) !== String(named[body.method])) return 'Mcp-Name header does not match body';
  if (body.method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === p.name);
    for (const [k, ps] of Object.entries((tool && tool.inputSchema.properties) || {})) {
      const hn = ps['x-mcp-header'];
      const v = (p.arguments || {})[k];
      if (!hn) continue;
      const got = headers['mcp-param-' + hn.toLowerCase()];
      if (v == null ? got !== undefined : decodeHeader(got) !== String(v)) return 'Mcp-Param-' + hn + ' header does not match argument';
    }
  }
  return null;
}

export function startMockServer(port = 0, host = '127.0.0.1') {
  const sessions = new Set();
  const calls = [];   // every JSON-RPC body received, for assertions

  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      if (path === '/hang') return;                                   // never answer
      if (path === '/slow') await new Promise((r) => setTimeout(r, 400));
      if (path === '/fail') return reply(res, 503, { error: 'upstream unavailable' });

      const accept = req.headers.accept || '';
      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
        return reply(res, 406, rpcErr(null, -32000, 'Not Acceptable: Client must accept both application/json and text/event-stream'));
      }

      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(res, 400, rpcErr(null, -32700, 'Parse error')); }
      calls.push({ path, body, headers: req.headers });

      const modernPath = path === '/modern' || path === '/dual';
      const version = ((body.params || {})._meta || {})[META + 'protocolVersion'];

      if (modernPath && (version || path === '/modern')) {
        if (body.method === 'initialize') {
          return reply(res, 400, rpcErr(body.id, -32022, 'Unsupported protocol version: this server speaks ' + MODERN_VERSION + ' only',
            { supported: [MODERN_VERSION], requested: (body.params || {}).protocolVersion }));
        }
        if (!version) return reply(res, 400, rpcErr(body.id, -32020, 'Missing io.modelcontextprotocol/protocolVersion in _meta'));
        const mismatch = headerMismatch(req.headers, body);
        if (mismatch) return reply(res, 400, rpcErr(body.id, -32020, 'Header mismatch: ' + mismatch));
        if (version !== MODERN_VERSION) {
          const supported = path === '/dual' ? [MODERN_VERSION, '2025-11-25'] : [MODERN_VERSION];
          return reply(res, 400, rpcErr(body.id, -32022, 'Unsupported protocol version', { supported, requested: version }));
        }
        if (body.id === undefined) return reply(res, 202, undefined);
        const cache = { ttlMs: 60000, cacheScope: 'public' };
        const ok = (result) => reply(res, 200, rpcOk(body.id, { resultType: 'complete', ...result, _meta: { [META + 'serverInfo']: SERVER_INFO } }));
        switch (body.method) {
          case 'server/discover':
            return ok({ supportedVersions: path === '/dual' ? [MODERN_VERSION, '2025-11-25'] : [MODERN_VERSION], capabilities: { tools: {}, resources: {}, prompts: {} }, ...cache });
          case 'tools/list': return ok({ tools: TOOLS, ...cache });
          case 'resources/list': return ok({ resources: RESOURCES, ...cache });
          case 'prompts/list': return ok({ prompts: PROMPTS, ...cache });
          case 'tools/call': case 'resources/read': case 'prompts/get': {
            const r = answer(body);
            if (r.error) return reply(res, 200, rpcErr(body.id, r.error.code, r.error.message));
            return ok(r.result);
          }
          default: return reply(res, 404, rpcErr(body.id, -32601, 'Method not found'));
        }
      }

      if (body.method === 'initialize') {
        const sid = randomUUID();
        sessions.add(sid);
        return reply(res, 200, rpcOk(body.id, {
          protocolVersion: '2025-03-26',
          serverInfo: SERVER_INFO,
          capabilities: { tools: {}, resources: {}, prompts: {} },
        }), { 'mcp-session-id': sid });
      }

      const sid = req.headers['mcp-session-id'];
      if (!sid || !sessions.has(sid)) {
        return reply(res, 400, rpcErr(null, -32000, 'Bad Request: No valid session ID provided'));
      }

      if (body.id === undefined) return reply(res, 202, undefined);   // notification

      switch (body.method) {
        case 'tools/list': return reply(res, 200, rpcOk(body.id, { tools: TOOLS }));
        case 'resources/list': return reply(res, 200, rpcOk(body.id, { resources: RESOURCES }));
        case 'prompts/list': return reply(res, 200, rpcOk(body.id, { prompts: PROMPTS }));
        case 'resources/read': case 'prompts/get': case 'tools/call': {
          const r = answer(body);
          if (r.error) return reply(res, 200, rpcErr(body.id, r.error.code, r.error.message));
          if (path === '/stream' && body.method === 'tools/call') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            return res.end('event: message\ndata: ' + JSON.stringify(rpcOk(body.id, r.result)) + '\n\n');
          }
          return reply(res, 200, rpcOk(body.id, r.result));
        }
        default:
          return reply(res, 200, rpcErr(body.id, -32601, 'Method not found'));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const base = `http://${host}:${server.address().port}`;
      resolve({
        base,
        url: base + '/mcp',
        calls,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = parseInt(process.env.PORT || '8788', 10);
  startMockServer(port).then((m) => {
    console.log(`Mock MCP server at ${m.url}`);
    console.log(`Failure modes: ${m.base}/slow  ${m.base}/hang  ${m.base}/fail  ${m.base}/stream`);
    console.log(`2026-07-28 protocol: ${m.base}/modern (stateless only)  ${m.base}/dual (both eras)`);
  });
}
