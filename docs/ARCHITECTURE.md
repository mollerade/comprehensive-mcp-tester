# Architecture

How MCP Tester is put together, for contributors. For using it, see the [README](../README.md).

## Layout

```text
src/
  core/proxy.js         MCP proxy: timeouts, retries, timing, Accept repair. No platform code.
  core/oauth-client.js  The tester's OAuth client metadata document (CIMD) and callback path
  core/compliance/      Spec compliance rule engine, catalogue and rules (pure: no network, no clock)
  hosts/cloudflare.js   Cloudflare adapter  → built into dist/worker.js and dist/worker.mjs
  hosts/node-server.js  Local adapter (plain node:http, no dependencies)
  ui/index.html         Page shell with @inline-css / @inline-js markers
  ui/styles.css         All styles, light and dark themes as tokens
  ui/js/*.js            Client code by concern; load order in js/ORDER.json
  ui/assemble.js        Inlines CSS + JS into one self-contained HTML page
scripts/build.mjs       Zero-dependency build → dist/
scripts/                Repository tooling (traceability and README checks)
tests/                  node:test suites + a mock MCP server fixture
docs/acceptance/        Acceptance criteria as Gherkin scenarios
```

## Why a proxy

Browsers can't call most MCP servers directly because the servers don't send CORS headers. So the page never talks to the MCP server itself: it posts to its own `/proxy` route, and the host forwards the request server-side. Every host serves the same single HTML page and the same `/proxy` contract. Adding a new way to run the tool (Docker, desktop) means writing a small adapter; neither the UI nor the proxy logic changes.

## Rules that keep it that way

- **`src/core/` stays platform-free.** No Cloudflare globals, no `node:` imports; the build fails if anything there reaches for either. Hosts inject `fetch`, `allowedOrigins` and `colo`. New core files must be added to the Worker concatenation (`CORE_FILES` in `scripts/build.mjs`).
- **Hosts are thin adapters.** A new runtime means a new adapter, not changes to core or UI.
- **The UI ships as one self-contained HTML file.** `src/ui/assemble.js` inlines the CSS and JS, every host serves that one string, and the Worker embeds it.
- **Client JS files are classic scripts sharing one global scope**, not ES modules, concatenated in `src/ui/js/ORDER.json` order. That keeps the shipped page a single file with no bundler. Top-level statements live only in `state.js` (first) and `main.js` (last); everything else is function declarations. The code is ES5-style (`var`, `function`, string concatenation) to run on older iPad Safari. Server-side code (core, hosts, build, tests) is modern ES modules.
- **The build has zero dependencies** and must keep producing a `dist/worker.js` that pastes into the Cloudflare dashboard editor (Service Worker format, no `import` / `export`). The build checks this itself.

## The `/proxy` contract

The UI depends on this envelope, so a change to it updates both hosts and their tests together. It is implemented in `proxyMcp()` in `src/core/proxy.js`.

**Request** (JSON body of `POST /proxy`):

| Field | Meaning |
| :--- | :--- |
| `url` | The MCP server (or, for OAuth, the discovery or token endpoint) |
| `method` | HTTP method, default `POST` |
| `headers` | Headers to send; hop-by-hop and origin headers are dropped |
| `body` | Request body as a string |
| `timeoutMs` | Clamped to 500 to 120000, default 15000 |
| `retries` | Clamped to 0 to 3, default 0 |
| `purpose` | `mcp` (default) or `oauth`; `oauth` skips the MCP `Accept` / `Content-Type` repair |

**Response:** HTTP 400 or 403 with `{ error }` for bad input or a target outside the allowlist. Otherwise HTTP 200 with:

| Field | Meaning |
| :--- | :--- |
| `status` | The server's HTTP status, or `0` when the transport failed (timeout or network) |
| `headers` | The server's response headers |
| `body` | The server's response body; on a transport failure, a JSON-RPC error |
| `diag` | `ok`, `errorType` (`timeout` or `network`), `errorDetail`, `ttfbMs`, `bodyMs`, `totalMs`, `attempts`, `attemptLog`, `colo`, `targetHost`, `timeoutMs` |

A transport failure is reported with HTTP 200 and envelope status 0 so the UI can always read the diagnostics.

## Decisions already made

These are settled; changing one is a conversation with the maintainers first.

- **Transport is Streamable HTTP only.** The old "SSE" option was removed because it was not a faithful legacy HTTP+SSE client. Streamable HTTP already accepts JSON or event-stream responses. stdio is out of scope: a hosted or browser app can't spawn local processes.
- **`Accept: application/json, text/event-stream` is enforced server-side**, because some servers answer 406 otherwise. Notifications carry no JSON-RPC `id`. Retries default to 0 so real failures stay visible.
- **The diagnostics timeline uses three states** (ok / slow / failed). Four were tried, but the warning and serious status colours measured ΔE 13.6, below the legibility floor. The failure kind lives in tooltips and the breakdown table instead.
- **The latency chart breaks its line across failures.** A lone success between failures renders as a dot; otherwise it would be invisible, and those are exactly the interesting samples.
- **Suggested tool requests** fill required parameters plus optional ones that have a default, enum, example or const, and never placeholder values for optional ones without a hint.
