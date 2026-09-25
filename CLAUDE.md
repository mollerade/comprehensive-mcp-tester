# CLAUDE.md

Context for Claude Code working in this repository. Read README.md for the user-facing overview.

## What this is

A browser-based MCP (Model Context Protocol) client for testing and diagnosing MCP servers. The primary real-world target is the HSBC Developer Portal MCP (`https://developer.hsbc.com/mcp`). The owner uses it from an iPad and a Mac, and wants it usable inside company networks without depending on a public website.

## Commands

```sh
npm install
npm test          # all suites, ~10s. Run before every commit.
npm run build     # dist/index.html, dist/worker.js (paste into Cloudflare), dist/worker.mjs (wrangler)
npm start         # local server on http://127.0.0.1:8787
npm run dev       # same, restarts on core/host changes; UI edits show on reload
npm run mock      # mock MCP server on http://127.0.0.1:8788/mcp (+ /slow /hang /fail /stream)
```

E2E tests need Chromium: `npx playwright install chromium`, or set `PW_CHROMIUM_PATH`. Without it they skip; they don't fail.

## Architecture rules

- **Edit `src/`, never `dist/`.** `dist/` is generated and gitignored.
- **`src/core/proxy.js` stays platform-free.** No Cloudflare globals, no `node:` imports. Hosts inject `fetch`, `allowedOrigins` and `colo`. The `/proxy` request/response envelope is a contract the UI depends on. Change it deliberately, and update both hosts and the tests together.
- **Hosts are thin adapters.** `src/hosts/cloudflare.js` (bundled into both Worker formats by the build) and `src/hosts/node-server.js`. A new runtime (Docker, desktop) means a new adapter, not changes to core or UI.
- **The UI ships as ONE self-contained HTML file.** `src/ui/assemble.js` inlines `styles.css` and the JS files. Keep it that way: every host serves one string, and the Worker embeds it.
- **Client JS files are classic scripts sharing one global scope**, not ES modules, concatenated in `src/ui/js/ORDER.json` order. Don't add `import`/`export` there. Top-level code only in `state.js` (first) and `main.js` (last); everything else is function declarations. New file → add it to ORDER.json.
- **Client JS is ES5-style** (`var`, `function`, string concatenation) to match the existing code and run on older iPad Safari. The server-side code (core, hosts, build, tests) is modern ES modules.
- **The build has zero dependencies** and must keep producing a `dist/worker.js` that pastes into the Cloudflare dashboard editor (Service Worker format, no `import`/`export`). The build self-checks this; don't weaken those checks.
- **No runtime dependencies.** Playwright is the only devDependency. Adding any package needs a strong reason: corporate users will audit it.

## Security invariants (tested; keep them)

- **Local server:** binds `127.0.0.1` by default. It rejects unknown `Host` headers (DNS rebinding) with 421. It rejects a foreign `Origin` on `/proxy` with 403, and non-JSON content types with 415. It never sends CORS grants. It is deliberately NOT an open proxy, because it runs inside company networks.
- **Cloudflare Worker:** public, open CORS (by design for v1). Before any credential handling ships, it needs `ALLOWED_ORIGINS` guidance plus Cloudflare Access, and ideally a same-origin check like the local host's.
- **Credentials** (roadmap step 2) should stay in memory by default, not `localStorage`.

## Decisions already made (don't relitigate without the owner)

- **Transport is Streamable HTTP only.** The old "SSE" option was removed because it was not a faithful legacy HTTP+SSE client (the old two-endpoint handshake: GET stream, then an `endpoint` event). Streamable HTTP already accepts JSON or event-stream responses. stdio is out of scope: a hosted or browser app can't spawn local processes.
- **Proxy behaviour:** `Accept: application/json, text/event-stream` is enforced server-side, because HSBC returns 406 otherwise. Notifications (`notifications/*`) carry no JSON-RPC `id`. Retries default to 0, so real failures stay visible. Transport failures return HTTP 200 with envelope `status: 0`, so the UI can always read the diagnostics.
- **Diagnostics timeline uses THREE states** (ok / slow / failed). Four were tried: the warning and serious status colours measured ΔE 13.6, below the legibility floor. Failure *kind* lives in tooltips and the breakdown table instead.
- **Latency chart:** lines break across failures. A lone success between failures renders as a dot; otherwise it would be invisible, and those are exactly the interesting samples.
- **Design:** French blue accent (light `#0067B1`, dark `#3B8FDD` with near-black text on filled buttons). Neutrals carry a slight blue bias. Everything goes through CSS tokens with three theme states: system (no attribute), `data-theme="light"`, `data-theme="dark"`. Request/response panels are tonally distinct (blue edge / green edge / red on error). Required/optional parameters show rose/blue pills. Dark-mode legibility was a specific owner complaint, so check both themes.
- **Suggested tool requests:** fill required params plus optionals that have a default, enum, example or const. Never pre-send placeholder junk for optionals without a hint.

## Roadmap (agreed order)

1. ~~Repo + shared core~~ (done, v0.8.0)
2. **Authentication (next).** Implement MCP authorization per spec 2025-11-25:
   - On 401, read `WWW-Authenticate` → protected resource metadata (RFC 9728) → authorization server metadata → register the client. Client ID Metadata Documents are preferred; dynamic client registration is the fallback. Then OAuth 2.1 auth code + PKCE with a redirect.
   - Log each discovery step: that's where servers break.
   - Manual modes: bearer, API-key header, client credentials (token endpoint), auth code + redirect.
   - Callbacks: `/oauth/callback` on the Worker, localhost on the Node host. The Worker can host a CIMD document at a public URL; the local host can't, so it falls back to DCR or a pre-registered client ID.
3. Log-driven hints. Rules first, not AI: 400 "no valid session" → initialise; 406 → Accept; 401 → sign in; 404 on a live session → reconnect; -32602 → jump to the field. Plus replay, edit & resend, copy as cURL, `{{variables}}`, collections. Stay MCP-shaped: not a general REST client.
4. Docker image for the Node host. Container binds 0.0.0.0, so `MCP_TESTER_ALLOWED_HOSTS` matters.
5. Signed Mac and Windows builds. Prefer Tauri or a small single binary over Electron. Code signing is the real blocker: Apple Developer ID + notarization; a Windows signing certificate.
6. Agent playground: an OpenAI-compatible endpoint (Ollama :11434, LM Studio :1234) acting as an MCP host. Framed as a test of tool-description quality using small (~8B) models. Belongs mainly in the local build.

## Working agreements

- Run `npm test` before committing. Add or adjust tests with every behaviour change; the e2e suite drives the real UI through the real proxy to the mock server.
- Keep `tests/fixtures/mock-mcp-server.mjs` realistic: it should fail the same ways real servers do.
- After UI changes, check light and dark and ~400px width (the e2e suite asserts no horizontal overflow).
- Deploying to Cloudflare today is manual: paste `dist/worker.js` into the dashboard, selecting and deleting ALL existing code first. A leftover-code paste once caused a confusing `Unexpected identifier` error.
