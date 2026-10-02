# AGENTS.md

Context for AI coding agents (Claude Code, Codex, Cursor and others) working in this repository. Human contributors will find the same rules, explained, in [CONTRIBUTING.md](CONTRIBUTING.md) and [DEVELOPMENT.md](DEVELOPMENT.md). Read README.md for the user-facing overview.

## What this is

A browser-based MCP (Model Context Protocol) client for testing and diagnosing MCP servers. The primary real-world target is the HSBC Developer Portal MCP (`https://developer.hsbc.com/mcp`). The owner uses it from an iPad and a Mac, and wants it usable inside company networks without depending on a public website.

## Commands

```sh
npm install
npm test          # all suites, ~10s. Run before every commit.
npm run test:trace # every AC in docs/acceptance/ has a test titled with its ID, and vice versa
make check        # test + trace + readme + links + build: the offline CI gate
npm run lint      # ESLint at zero findings (npm ci --prefix tools/lint first); new code must meet the complexity ceilings
make docs         # user manual (pip install --require-hashes -r docs/manual/requirements.txt first)
npm run build     # dist/index.html, dist/worker.js (paste into Cloudflare), dist/worker.mjs (wrangler)
npm start         # local server on http://127.0.0.1:8787
npm run dev       # same, restarts on core/host changes; UI edits show on reload
npm run mock      # mock MCP server on http://127.0.0.1:8788/mcp (+ /slow /hang /fail /stream; /scenario/<name>/mcp, GET /__scenarios)
npm run compliance -- <url> [--header "Name: value"] [--json]   # probe a server and grade it (exit 1 on a failing rule)
```

E2E tests need Chromium: `npx playwright install chromium`, or set `PW_CHROMIUM_PATH`. Without it they skip; they don't fail.

## Architecture rules

- **Edit `src/`, never `dist/`.** `dist/` is generated and gitignored.
- **`src/core/` stays platform-free.** No Cloudflare globals, no `node:` imports. Hosts inject `fetch`, `allowedOrigins` and `colo`. The `/proxy` request/response envelope is a contract the UI depends on. Change it deliberately, and update both hosts and the tests together. `purpose: 'oauth'` (0.10.0) skips the MCP Accept/Content-Type repair for discovery and token calls. New core files must be added to the Worker concatenation (`CORE_FILES` in `scripts/build.mjs`). The build fails if anything under `src/core/` imports a `node:` module or uses a Cloudflare-only API.
- **Hosts are thin adapters.** `src/hosts/cloudflare.js` (bundled into both Worker formats by the build) and `src/hosts/node-server.js`. A new runtime (Docker, desktop) means a new adapter, not changes to core or UI.
- **The UI ships as ONE self-contained HTML file.** `src/ui/assemble.js` inlines `styles.css` and the JS files. Keep it that way: every host serves one string, and the Worker embeds it.
- **Client JS files are classic scripts sharing one global scope**, not ES modules, concatenated in `src/ui/js/ORDER.json` order. Don't add `import`/`export` there. Top-level code only in `state.js` (first) and `main.js` (last); everything else is function declarations. New file → add it to ORDER.json.
- **Client JS is ES5-style** (`var`, `function`, string concatenation) to match the existing code and run on older iPad Safari. The server-side code (core, hosts, build, tests) is modern ES modules.
- **The build has zero dependencies** and must keep producing a `dist/worker.js` that pastes into the Cloudflare dashboard editor (Service Worker format, no `import`/`export`). The build self-checks this; don't weaken those checks.
- **No runtime dependencies.** Playwright is the only devDependency. Adding any package needs a strong reason: corporate users will audit it.
- **Compliance rules are data graded by a pure engine.** `src/core/compliance/engine.js` selects rules by the server's claimed version (unknown → newest set, marked best effort) and grades recorded exchanges; it never sends anything. A rule is `{ id: 'MCP-<CATEGORY>-<NNN>', title, category, severity: 'fail'|'warn', appliesTo, specRef (https), needsProbe?, check(ctx) }` in `rules/<category>.js`, listed in `catalogue.js`, and cites the spec section it enforces. Every rule needs a mock scenario that breaks it (`tests/fixtures/mock/scenarios/violations.mjs`), listed in the violation table of `tests/compliance/rules.test.js`, which fails on a rule without one. `collect.js` sends the probes (through an injected `send`) and records the exchanges the rules read; rules never send anything. When the server answers 401/403 (or, given headers, once without them), `collect-auth.js` follows authorization discovery into `ctx.auth` (GETs only, never the caller's headers) for the `rules/auth.js` rules. Shared helpers live in `rules/helpers.js`; every top-level name in `src/core/` must be unique, because the Worker build joins the files into one script.

## Security invariants (tested; keep them)

- **Local server:** binds `127.0.0.1` by default. It rejects unknown `Host` headers (DNS rebinding) with 421. It rejects a foreign `Origin` on `/proxy` with 403, and non-JSON content types with 415. It never sends CORS grants. It is deliberately NOT an open proxy, because it runs inside company networks. It refuses to start off loopback without `MCP_TESTER_TOKEN` (32+ characters); with a token every request needs it (cookie from the access link, holding an HMAC, or `Authorization: Bearer`), except `/oauth/client-metadata.json`.
- **Target policy** (`src/core/target-policy.js`, both hosts): http/https only; special-purpose addresses refused unless their host or exact origin is in `MCP_TESTER_ALLOWED_TARGETS` (`*` = any public host, never special-purpose ones). The proxy follows redirects itself (`redirect: 'manual'`, at most 5) and checks every hop; a cross-origin hop keeps only protocol headers. The Node host's fetch (`src/hosts/guarded-fetch.js`) checks resolved addresses in the socket lookup. A refusal is a 403 `{ error, hint }`, never retried, shown in the UI as a failed call (`errorType: 'proxy'`).
- **Cloudflare Worker:** public, but since 0.10.0 no longer an open CORS proxy, and since 0.10.1 closed by default: `/proxy` refuses every target until `MCP_TESTER_ALLOWED_TARGETS` (or the older `ALLOWED_ORIGINS`) is set. It rejects a foreign `Origin` with 403, and no response carries CORS grants. Deployment guidance (README, worker banner): set `MCP_TESTER_ALLOWED_TARGETS` (MCP and authorization server hosts), put Cloudflare Access in front, and bypass `/oauth/client-metadata.json`.
- **Credentials live in memory** (`auth` in `state.js`), never in `localStorage`. They are bound to the server they were set up for (`auth.boundTo`) and never sent to another. Tokens and secrets are redacted from the Log (`REDACT_KEYS`). The only exception is the redirect fallback: the in-flight request (PKCE verifier, state, expected issuer, trace) is kept in `sessionStorage` and removed when the page returns. A client secret is never persisted: if the sign-in needs one, the page asks for it again on return instead of exchanging the code. The older Headers dialog still persists to `localStorage`. That is known, and the UI steers tokens to Auth.
- **Content-Security-Policy:** both hosts send `CONTENT_SECURITY_POLICY` (`src/core/security-headers.js`) with the HTML. The e2e suite fails on any CSP violation, so a feature that needs another origin must change the policy deliberately.
- **OAuth checks are enforced, not just reported:** issuer mismatch in AS metadata (unless the user turns on the off-by-default `auth.allowIssuerMismatch` testing switch, which must keep warning in the dialog and the trace), `iss` in the authorization response (RFC 9207 table; checked before an `error` is shown or the code is used), `state`, and PKCE S256 support. A protected resource metadata `resource` mismatch is reported as a warning but not enforced, so testing can continue.

## Decisions already made (don't relitigate without the owner)

- **Transport is Streamable HTTP only.** The old "SSE" option was removed because it was not a faithful legacy HTTP+SSE client (the old two-endpoint handshake: GET stream, then an `endpoint` event). Streamable HTTP already accepts JSON or event-stream responses. stdio is out of scope: a hosted or browser app can't spawn local processes. The client is dual-era: it tries the 2026-07-28 stateless protocol first and falls back to the legacy `initialize` handshake (see roadmap item 2).
- **Proxy behaviour:** `Accept: application/json, text/event-stream` is enforced server-side, because HSBC returns 406 otherwise. Notifications (`notifications/*`) carry no JSON-RPC `id`. Retries default to 0, so real failures stay visible. Transport failures return HTTP 200 with envelope `status: 0`, so the UI can always read the diagnostics.
- **Diagnostics timeline uses THREE states** (ok / slow / failed). Four were tried: the warning and serious status colours measured ΔE 13.6, below the legibility floor. Failure *kind* lives in tooltips and the breakdown table instead.
- **Latency chart:** lines break across failures. A lone success between failures renders as a dot; otherwise it would be invisible, and those are exactly the interesting samples.
- **Design:** French blue accent (light `#0067B1`, dark `#3B8FDD` with near-black text on filled buttons). Neutrals carry a slight blue bias. Everything goes through CSS tokens with three theme states: system (no attribute), `data-theme="light"`, `data-theme="dark"`. Request/response panels are tonally distinct (blue edge / green edge / red on error). Required/optional parameters show rose/blue pills. Dark-mode legibility was a specific owner complaint, so check both themes.
- **Suggested tool requests:** fill required params plus optionals that have a default, enum, example or const. Never pre-send placeholder junk for optionals without a hint.

## Roadmap

[`ROADMAP.md`](ROADMAP.md) is the single source: the agreed order, each item's detail (including what is not yet done in authentication and in the 2026-07-28 spec), and the fork issues that track it. Keep it current when an item ships, and strike the item out in the table with its version.

## Working agreements

- Run `make check` before committing (tests, traceability, README, links, build); `pre-commit install` runs the fast checks on every commit. The README follows a fixed section layout (see `scripts/check-readme.mjs`); add content inside the existing sections, not new ones. Add or adjust tests with every behaviour change; the e2e suite drives the real UI through the real proxy to the mock server.
- Keep `tests/fixtures/mock-mcp-server.mjs` realistic: it should fail the same ways real servers do. New misbehaviour is a new scenario in `tests/fixtures/mock/scenarios/` (served on `/scenario/<name>/mcp`), not a new top-level path; `startMock({ port: 0 })` gives each test its own instance.
- After UI changes, check light and dark and ~400px width (the e2e suite asserts no horizontal overflow).
- Deploying to Cloudflare today is manual: paste `dist/worker.js` into the dashboard, selecting and deleting ALL existing code first. A leftover-code paste once caused a confusing `Unexpected identifier` error.
