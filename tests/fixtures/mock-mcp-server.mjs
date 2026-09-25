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
        category: { type: 'string', description: 'The API category to list.' },
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

function reply(res, status, obj, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}));
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: id ?? null });
const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });

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

      if (body.method === 'initialize') {
        const sid = randomUUID();
        sessions.add(sid);
        return reply(res, 200, rpcOk(body.id, {
          protocolVersion: '2025-03-26',
          serverInfo: { name: 'mock-mcp', version: '1.0.0' },
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
        case 'resources/read':
          return reply(res, 200, rpcOk(body.id, { contents: [{ uri: body.params.uri, mimeType: 'text/markdown', text: '# Getting started' }] }));
        case 'prompts/get':
          return reply(res, 200, rpcOk(body.id, { messages: [{ role: 'user', content: { type: 'text', text: 'Summarise ' + (body.params.arguments || {}).api_id } }] }));
        case 'tools/call': {
          const tool = TOOLS.find((t) => t.name === (body.params || {}).name);
          if (!tool) return reply(res, 200, rpcErr(body.id, -32602, 'Unknown tool'));
          const args = (body.params || {}).arguments || {};
          const missing = (tool.inputSchema.required || []).filter((k) => !(k in args));
          if (missing.length) return reply(res, 200, rpcErr(body.id, -32602, 'Missing required argument: ' + missing.join(', ')));
          const result = rpcOk(body.id, { content: [{ type: 'text', text: 'ok: ' + JSON.stringify(args) }] });
          if (path === '/stream') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            return res.end('event: message\ndata: ' + JSON.stringify(result) + '\n\n');
          }
          return reply(res, 200, result);
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
  });
}
