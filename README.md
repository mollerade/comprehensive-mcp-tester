# MCP Tester

A browser-based client for testing and diagnosing **Model Context Protocol** servers. Connect to any Streamable HTTP MCP server, browse its tools, resources and prompts, call them from a form or raw JSON-RPC, and see the exact request, response, status and timing of every exchange. It also has a health monitor for servers that time out intermittently.

It runs in two places from one codebase:

- **Hosted**, as a Cloudflare Worker: nothing to install, and it works from an iPad.
- **Locally**, as a small Node server: nothing leaves your machine except calls to the MCP server itself. This is the version to use inside company networks.

## Run it

**On Cloudflare, no tools needed.** Take `dist/worker.js` from a build (or from the CI artifact) and follow the instructions at the top of that file: create a "Hello World" Worker, replace all of its code with the file, and deploy.

**On Cloudflare with Wrangler**

```sh
npm install
npm run deploy          # builds, then `wrangler deploy` using wrangler.toml
```

**Locally** (Node 20+)

```sh
npm install
npm start               # http://127.0.0.1:8787
```

Try it against the bundled mock server:

```sh
npm run mock            # http://127.0.0.1:8788/mcp   (plus /slow /hang /fail /stream)
```

`/mcp` and the failure paths behave like a pre-2026 server (with an `initialize` handshake and sessions). `/modern` speaks only the stateless 2026-07-28 protocol, and `/dual` speaks both. The tester works out which one it's talking to. The status pill tooltip shows the protocol version and whether the connection is stateless or legacy.

| Variable | Where | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | both | Comma-separated MCP hosts the proxy may reach, e.g. `developer.hsbc.com`. Empty means any. |
| `PORT`, `HOST` | local | Defaults `8787`, `127.0.0.1`. |
| `MCP_TESTER_ALLOWED_HOSTS` | local | Extra `Host` header values to accept when serving under a hostname. |

## How it fits together

```
src/
  core/proxy.js         MCP proxy: timeouts, retries, timing, Accept repair. No platform code.
  hosts/cloudflare.js   Cloudflare adapter  → built into dist/worker.js and dist/worker.mjs
  hosts/node-server.js  Local adapter (plain node:http, no dependencies)
  ui/index.html         Page shell with @inline-css / @inline-js markers
  ui/styles.css         All styles, light and dark themes as tokens
  ui/js/*.js            Client code by concern; load order in js/ORDER.json
  ui/assemble.js        Inlines CSS + JS into one self-contained HTML page
scripts/build.mjs       Zero-dependency build → dist/
tests/                  node:test suites + a mock MCP server fixture
```

Browsers can't call most MCP servers directly because the servers don't send CORS headers. So the page never talks to the MCP server itself: it posts to its own `/proxy` route, and the host forwards the request server-side. Every host serves the same single HTML page and the same `/proxy` contract. Adding a new way to run the tool (Docker, desktop) means writing a small adapter; neither the UI nor the proxy logic changes.

The client JS files are classic scripts that share one global scope, concatenated in `ORDER.json` order. That keeps the shipped page a single file with no bundler. Only top-level statements depend on order: `state.js` runs first, `main.js` last.

## Develop

```sh
npm run dev             # local server; restarts on core/host changes, UI edits show on reload
npm test                # all suites (~10s)
npm run build           # regenerate dist/
```

Edit files in `src/`, never in `dist/`. The build checks its own output before writing: the HTML must round-trip exactly, `worker.js` must parse, and no module syntax may remain in the paste-able file.

## Tests

`npm test` runs 100 tests with Node's built-in runner:

- **proxy**: the core against a mock server. Covers timing, timeouts, retries with backoff, network failures, Accept repair, header filtering and the allowlist.
- **hosts**: both Cloudflare bundles, executed as built, and the local server, including its security checks.
- **ui-logic**: the shipped client JS in a VM. Covers the percentile and uptime maths, flap streaks, schema-based request suggestions and JSON-RPC ids.
- **e2e**: Chromium drives the real UI through the local server to the mock MCP server. Covers connect, filter, suggested requests, form and JSON execution, error responses, resources, prompts, log, diagnostics, theme, saved servers, timeouts and phone-width layout.

The e2e suite skips itself if Chromium isn't installed (`npx playwright install chromium`). CI runs everything on Node 20 and 22 and uploads `dist/` as an artifact.

## Security

- **The local server is not an open proxy.** It binds to loopback. It rejects unknown `Host` headers, which blocks DNS rebinding, and it rejects `/proxy` calls from other origins. It also requires `Content-Type: application/json`, so no other web page you visit can use it to reach internal systems.
- **The Cloudflare Worker is public.** Anyone with its URL can use it as a proxy. Set `ALLOWED_ORIGINS`, and put Cloudflare Access in front of it before using it with credentials.

## Roadmap

1. ~~Repository and shared core~~ (0.8.0)
2. ~~Speaks both the 2026-07-28 stateless protocol and the older `initialize` handshake~~ (0.9.0)
3. Authentication: MCP OAuth discovery (protected resource metadata, CIMD, DCR fallback, PKCE, `iss` check), plus bearer, API key and client credentials
4. Spec compliance check: pass / warn / fail against the protocol version the server claims
5. Log-driven hints, a connection flow diagram (exportable as Mermaid for GitHub), replay, copy as cURL, variables, collections
6. Docker image for the local server
7. Signed Mac and Windows builds
8. Agent playground: connect a local model (Ollama / LM Studio) to test how well tool descriptions work
