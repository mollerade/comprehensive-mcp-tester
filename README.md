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

Every behaviour is also a named scenario at `/scenario/<name>/mcp`, including deliberate spec violations such as `wrong-jsonrpc-version`, `id-mismatch` and `as-no-s256`. `GET /__scenarios` lists them all, and adding `?delay=<ms>` to any request makes it arrive late.

| Variable | Where | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | both | Comma-separated hosts the proxy may reach, e.g. `developer.hsbc.com`. Include your authorization server's host if you sign in with OAuth. Empty means any. |
| `PORT`, `HOST` | local | Defaults `8787`, `127.0.0.1`. |
| `MCP_TESTER_ALLOWED_HOSTS` | local | Extra `Host` header values to accept when serving under a hostname. |

## Signing in

Open **Auth** next to Headers. When a server answers 401, this opens by itself. Credentials are kept in memory only: reloading the page forgets them. They are only sent to the server they were set up for, and tokens and secrets are redacted from the Log.

| Mode | What it does |
|---|---|
| OAuth sign-in | Follows the MCP authorization spec (2026-07-28). It reads the 401 challenge, fetches the protected resource metadata and the authorization server metadata, and registers the tester. Then it signs you in with PKCE in a pop-up, checks the `iss` in the response, and exchanges the code for a token, sending the `resource` parameter throughout. **Discover only** runs the discovery steps without signing in. |
| Bearer token | Sends `Authorization: Bearer <token>`. |
| API key header | Sends a header you name, e.g. `X-API-Key`. |
| Client credentials | Exchanges a client ID and secret for a token. The token endpoint is discovered unless you enter one. |

Every step appears in a trace (ok / warning / failed) and in the Log, because discovery is where servers usually break.

**Client registration.** A client ID you enter is used first. Otherwise the tester uses a *client ID metadata document*, which it hosts at `/oauth/client-metadata.json`. That only works on the Worker, because an authorization server can't fetch a document from `localhost`. As a last resort it uses dynamic client registration, which the spec now deprecates.

**Pop-ups.** Sign-in normally happens in a pop-up. If pop-ups are blocked, the page redirects to the sign-in page and picks up where it left off when it comes back. Only the in-flight request is kept (in this tab's `sessionStorage`), and it is deleted as soon as the page returns.

Try it against the mock server: `/secure` is the normal case. `/secure-nohint` has no `resource_metadata` hint in its challenge. `/secure-mixup` returns the wrong `iss`, which the tester must reject. For client credentials, use `cc-client` / `cc-secret`.

## How it fits together

```
src/
  core/proxy.js         MCP proxy: timeouts, retries, timing, Accept repair. No platform code.
  core/oauth-client.js  The tester's OAuth client metadata document (CIMD) and callback path
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
npm run test:trace      # every acceptance criterion has a test, and every AC-titled test has a criterion
npm run build           # regenerate dist/
```

Edit files in `src/`, never in `dist/`. The build checks its own output before writing: the HTML must round-trip exactly, `worker.js` must parse, and no module syntax may remain in the paste-able file.

## Tests

`npm test` runs 154 tests with Node's built-in runner:

- **proxy**: the core against a mock server. Covers timing, timeouts, retries with backoff, network failures, Accept repair, header filtering and the allowlist. It also covers the mock server's scenario registry: discovery, the original paths as aliases, parallel instances, the delay knob, and that each violation scenario breaks the rule it names.
- **hosts**: both Cloudflare bundles, executed as built, and the local server, including its security checks.
- **ui-logic**: the shipped client JS in a VM. Covers the percentile and uptime maths, flap streaks, schema-based request suggestions and JSON-RPC ids.
- **e2e**: Chromium drives the real UI through the local server to the mock MCP server. Covers both protocol eras, OAuth sign-in (pop-up and redirect), the `iss` mix-up rejection, client credentials, connect, filter, suggested requests, form and JSON execution, error responses, resources, prompts, log, diagnostics, theme, saved servers, timeouts and phone-width layout.
- **compliance**: the spec compliance rule engine (`src/core/compliance/`), which grades recorded exchanges against the protocol version a server claims. Covers the catalogue format, rule selection by version, best effort for unknown versions, error isolation and determinism.
- **tooling**: the repository's own scripts, such as the traceability checker, run as real processes against throwaway fixture trees.

Acceptance criteria live as tagged Gherkin scenarios in `docs/acceptance/v<milestone>/<ISSUE-KEY>.feature` (for example `@AC-QA-TRACE-01`). A test covers one when its title starts with the ID: `test('AC-QA-TRACE-01: covered AC passes', ...)`. `npm run test:trace` fails on a criterion with no test, a test naming an unknown criterion, a duplicated ID, or an `@pending` criterion still untested once `package.json` reaches its milestone; `--format=json` prints the same report as JSON.

The e2e suite skips itself if Chromium isn't installed (`npx playwright install chromium`). CI runs everything, including `npm run test:trace`, on Node 20 and 22 and uploads `dist/` as an artifact.

## Security

- **The local server is not an open proxy.** It binds to loopback. It rejects unknown `Host` headers, which blocks DNS rebinding, and it rejects `/proxy` calls from other origins. It also requires `Content-Type: application/json`, so no other web page you visit can use it to reach internal systems.
- **The Cloudflare Worker is public.** Other web pages can't drive it: since 0.10.0, `/proxy` rejects foreign origins and sends no CORS grants. But anyone with its URL can still open it. Before using it with credentials:
  - Set `ALLOWED_ORIGINS` to your MCP server and authorization server hosts.
  - Put Cloudflare Access in front of it.
  - Add a bypass for `/oauth/client-metadata.json`, so authorization servers can fetch the client metadata document.
- **Saved headers are stored in the browser.** The Headers dialog saves its values in `localStorage`. Use Auth for tokens and keys: it keeps them in memory only.

## Roadmap

1. ~~Repository and shared core~~ (0.8.0)
2. ~~Speaks both the 2026-07-28 stateless protocol and the older `initialize` handshake~~ (0.9.0)
3. ~~Authentication: MCP OAuth discovery, CIMD / DCR, PKCE, `iss` check; bearer, API key, client credentials~~ (0.10.0)
4. Spec compliance check: pass / warn / fail against the protocol version the server claims
5. Log-driven hints, a connection flow diagram (exportable as Mermaid for GitHub), replay, copy as cURL, variables, collections
6. Docker image for the local server
7. Signed Mac and Windows builds
8. Agent playground: connect a local model (Ollama / LM Studio) to test how well tool descriptions work
