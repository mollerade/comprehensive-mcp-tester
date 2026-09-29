<!-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 -->

<p align="center">
  <img src="docs/assets/logo.svg" alt="MCP Tester logo" width="128" />
</p>

<h1 align="center">MCP Tester</h1>

<p align="center">
  A browser-based client for testing and diagnosing Model Context Protocol servers, hosted on Cloudflare or run locally.
</p>

<p align="center">
  <a href="https://github.com/mollerade/comprehensive-mcp-tester/actions"><img src="https://img.shields.io/github/actions/workflow/status/mollerade/comprehensive-mcp-tester/ci.yml?branch=main&style=for-the-badge&logo=github&label=build" alt="Build" /></a>
  <a href="#install"><img src="https://img.shields.io/badge/registry-not%20published-lightgrey?style=for-the-badge&color=fc8d62&logo=nodedotjs" alt="Registry" /></a>
  <a href="#documentation"><img src="https://img.shields.io/badge/docs-in%20repo-blue?style=for-the-badge&labelColor=555555&logo=markdown" alt="Docs" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg?style=for-the-badge" alt="License: PolyForm Noncommercial 1.0.0" /></a>
  <a href="https://github.com/mollerade/comprehensive-mcp-tester/blob/main/docs/POLICIES.md"><img src="https://img.shields.io/badge/node-22%2B-93450a.svg?style=for-the-badge&logo=nodedotjs" alt="Node.js 22 or later" /></a>
</p>

---

## Contents

**Getting started**

- [Install](#install) — hosted on Cloudflare (no tools), with Wrangler, as a local Node server, or as an installed command
- [Requirements](#requirements) — toolchain floor, platforms
- [Quick Start](#quick-start) — run the tester against the bundled mock server in two commands

**The MCP Tester ecosystem**

- [The MCP Tester ecosystem](#the-mcp-tester-ecosystem) — shared proxy core, Cloudflare and Node hosts, single-file UI, mock MCP server

**Library reference**

- [Capabilities at a glance](#capabilities-at-a-glance) — the current surface by theme
- [Features](#features) — module-level capability list
- [Configuration](#configuration) — core options
- [Examples](#examples) — runnable example index

**Operational**

- [When not to use MCP Tester](#when-not-to-use-mcp-tester) — limitations
- [Development](#development) — make targets, fuzzing, CI
- [Security](#security) — guarantees and compliance
- [Documentation](#documentation) — all reference docs
- [Stability guarantees](#stability-guarantees) — SemVer axis, output stability, minimum toolchain discipline
- [License](#license)

---

## Install

### As a Node.js library

Not applicable: MCP Tester is an application, not a library, and it is not published to npm (`package.json` is `"private": true`). Run it from a checkout or deploy it as a Cloudflare Worker.

**On Cloudflare, no tools needed.** Take `worker.js` from a [release](https://github.com/sebastienrousseau/comprehensive-mcp-tester/releases) (or `dist/worker.js` from a build) and follow the instructions at the top of that file: create a "Hello World" Worker, replace all of its code with the file, and deploy.

Every release file comes with a SHA-256 checksum and signed build provenance. To check a download before deploying it:

```sh
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify worker.js --repo sebastienrousseau/comprehensive-mcp-tester
```

**On Cloudflare with Wrangler**

```sh
npm install
npm run deploy          # builds, then `wrangler deploy` using wrangler.toml
```

**Locally**

```sh
npm install
npm start               # http://127.0.0.1:8787
```

**As a command**, from a checkout:

```sh
make install            # installs `mcp-tester` into /usr/local (PREFIX=... and DESTDIR=... honoured)
mcp-tester              # http://127.0.0.1:8787
make uninstall
```

The local server is the version to use inside company networks: nothing leaves your machine except the calls to the MCP server itself.

---

## Requirements

- **Node.js 22 or later** (`engines` in `package.json`), the oldest Node.js LTS still in maintenance; CI tests Node 22 and 24. See [`docs/POLICIES.md`](docs/POLICIES.md).
- **A current browser** for the UI. The client code is kept ES5-style so it runs on older iPad Safari.
- **Chromium**, only for the end-to-end tests: `npx playwright install chromium`, or set `PW_CHROMIUM_PATH`. Without it those tests skip.
- **No runtime dependencies.** Playwright is the only dev dependency.

---

## Quick Start

```sh
npm install
npm run mock            # mock MCP server on http://127.0.0.1:8788/mcp
MCP_TESTER_ALLOWED_TARGETS=http://127.0.0.1:8788 npm start   # the tester on http://127.0.0.1:8787, in a second terminal
```

The proxy refuses loopback and private addresses unless they are listed, so a local server such as the mock needs its origin in `MCP_TESTER_ALLOWED_TARGETS`. Public servers need nothing.

Open <http://127.0.0.1:8787>, enter `http://127.0.0.1:8788/mcp` and press **Connect**. The tester works out which protocol era the server speaks, lists its tools, resources and prompts, and suggests a starting request for each tool. Every exchange appears in the **Log** with its status and timing, and **Diagnostics** tracks latency and failures over time.

---

## The MCP Tester ecosystem

Browsers can't call most MCP servers directly because the servers don't send CORS headers. So the page never talks to the MCP server itself: it posts to its own `/proxy` route, and the host forwards the request server-side. Every host serves the same single HTML page and the same `/proxy` contract, so a new way to run the tool means a small adapter, not changes to the UI or the proxy. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| Component | Purpose | Use case |
| :--- | :--- | :--- |
| `src/core/` | MCP proxy (timeouts, retries, timing, Accept repair), the OAuth client metadata document, and the compliance rule engine; no platform code, checked by the build | Shared by every host |
| `src/hosts/cloudflare.js` | Cloudflare adapter, built into `dist/worker.js` and `dist/worker.mjs` | Hosted use, from any device including an iPad |
| `src/hosts/node-server.js` | Local adapter on plain `node:http`, bound to loopback | Use inside company networks |
| `src/ui/` | The UI, assembled into one self-contained HTML page | Served unchanged by every host |
| `tests/fixtures/mock-mcp-server.mjs` | Mock MCP server with named scenarios, including deliberate spec violations | Trying the tester offline; the test suites |

---

## Capabilities at a glance

| Area | Capability | Status |
| :--- | :--- | :--- |
| Hosting | One codebase, served as a Cloudflare Worker or a local Node server | Shipped (0.8.0) |
| Transport | Streamable HTTP, JSON or event-stream responses | Shipped |
| Protocol | 2026-07-28 stateless protocol, with fallback to the `initialize` handshake | Shipped (0.9.0) |
| Exploring | Tools, resources and prompts; form or raw JSON-RPC; raw request and response panels | Shipped |
| Authentication | MCP OAuth discovery, CIMD / DCR, PKCE, `iss` check; bearer, API key, client credentials | Shipped (0.10.0) |
| Diagnostics | Log with timing, health monitor, ok / slow / failed timeline, latency chart | Shipped |
| Compliance | Pass / warn / fail check against the protocol version the server claims | In progress: engine and 35 rules, including authorization, run from the command line; the in-app report next ([roadmap 4](ROADMAP.md)) |
| Workflow | Log-driven hints, flow diagram, replay, copy as cURL, variables, collections | Planned ([roadmap 5](ROADMAP.md)) |
| Packaging | Docker image; signed Mac and Windows builds | Planned ([roadmap 6 and 7](ROADMAP.md)) |
| Agent playground | Test tool descriptions with a local model | Planned ([roadmap 8](ROADMAP.md)) |

---

## Features

**Exploring a server.** Connect to any Streamable HTTP MCP server and browse its tools, resources and prompts. Call a tool from a form built from its input schema (required and optional parameters are labelled, and a starting request is suggested), or edit and send the raw JSON-RPC. Each call shows the exact request, response, HTTP status and timing.

**Both protocol eras.** The client tries the 2026-07-28 stateless protocol first (`server/discover`, per-request `_meta`, mirrored `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` / `Mcp-Param-*` headers) and falls back to the `initialize` handshake when the server answers with an HTTP error that is not a recognised modern error. The status pill tooltip shows the protocol version and whether the connection is stateless or legacy.

**Signing in.** Open **Auth** next to Headers; when a server answers 401, it opens by itself. Credentials are kept in memory only, are only sent to the server they were set up for, and tokens and secrets are redacted from the Log.

| Mode | What it does |
| :--- | :--- |
| OAuth sign-in | Follows the MCP authorization spec (2026-07-28). It reads the 401 challenge, fetches the protected resource metadata and the authorization server metadata, and registers the tester. Then it signs you in with PKCE in a pop-up, checks the `iss` in the response, and exchanges the code for a token, sending the `resource` parameter throughout. **Discover only** runs the discovery steps without signing in. |
| Bearer token | Sends `Authorization: Bearer <token>`. |
| API key header | Sends a header you name, e.g. `X-API-Key`. |
| Client credentials | Exchanges a client ID and secret for a token. The token endpoint is discovered unless you enter one. For token endpoints that want their own field names, **Send the credentials as: Custom field names** sends, say, `profileID` and `secret`, as a form or JSON, with or without `grant_type`, `scope` and `resource`. |

Every sign-in step appears in a trace (ok / warning / failed) and in the Log, because discovery is where servers usually break.

- **Client registration.** A client ID you enter is used first. Otherwise the tester uses a client ID metadata document, which it hosts at `/oauth/client-metadata.json`. That only works on the Worker, because an authorization server can't fetch a document from `localhost`. As a last resort it uses dynamic client registration, which the spec now deprecates.
- **Token renewal.** A token that expires within a minute is renewed before the next request: with the refresh token after an OAuth sign-in, or with the client credentials again. A 401 to the current token renews it once and resends the request. Each renewal is a trace step and a Log entry; one that fails is not retried, and you sign in again.
- **Issuer mismatch.** Authorization server metadata whose `issuer` differs from the one the resource names must not be used (RFC 8414 §3.3), so discovery stops. To test the rest of a server that has this bug, turn on **Continue past an issuer mismatch** (off by default): discovery carries on, with a warning in the dialog and the trace. The `iss` in the authorization response is still checked.
- **Pop-ups.** Sign-in normally happens in a pop-up. If pop-ups are blocked, the page redirects to the sign-in page and picks up where it left off when it comes back. Only the in-flight request is kept (in this tab's `sessionStorage`), and it is deleted as soon as the page returns. A client secret is never kept: if the sign-in needs one, you are asked to enter it again, or you can allow pop-ups.

**Compliance check.** `npm run compliance -- <server url>` probes a server and grades it against the protocol version it claims: JSON-RPC 2.0 messages, Streamable HTTP status codes and content types, sessions or stateless version negotiation, the handshake, and what it lists (capabilities, tool names and JSON Schemas, `x-mcp-header` annotations, resources, prompts, paging). A server that asks for a sign-in also has its authorization discovery graded: the `WWW-Authenticate` challenge, the protected resource metadata, and the authorization server metadata (issuer match, PKCE S256, https endpoints, registration options, `iss` support); this needs no token, and discovery never sends one. Each finding links the spec section, and the report is Markdown, or JSON with `--json`; the exit code is 1 when a rule fails. The probes never call a tool, read a resource or get a prompt. Add `--header "Authorization: Bearer $TOKEN"` for a server that needs a sign-in. An in-app report is planned.

**Diagnostics.** The health monitor probes the server on an interval and records every call. The timeline uses three states (ok / slow / failed), with the failure kind in tooltips and the breakdown table; the latency chart breaks its line across failures so a lone success between failures still shows.

---

## Configuration

| Variable | Where | Meaning |
| :--- | :--- | :--- |
| `MCP_TESTER_ALLOWED_TARGETS` | both | Comma-separated hosts (any port) or exact origins the proxy may reach, e.g. `developer.hsbc.com,http://127.0.0.1:8788`. Include your authorization server's host if you sign in with OAuth. `*` means any public host. Loopback, private, link-local and other special-purpose addresses are reached only when listed. Empty means any public host on the local server, and **nothing** on the Worker. `ALLOWED_ORIGINS` is the older name and still works. |
| `PORT`, `HOST` | local | Defaults `8787`, `127.0.0.1`. |
| `MCP_TESTER_ALLOWED_HOSTS` | local | Extra `Host` header values to accept when serving under a hostname. |
| `MCP_TESTER_TOKEN` | local | Access token, 32 or more characters. Required when `HOST` is not loopback; then every request needs it. The server prints an access link that sets a cookie; scripts send `Authorization: Bearer <token>`. |

Request timeout and retries are set in the UI. Retries default to 0, so real failures stay visible.

---

## Examples

The bundled mock server (`npm run mock`) is the example set. Point the tester at any of these:

| URL path | Shows |
| :--- | :--- |
| `/mcp` | A normal pre-2026 server: `initialize` handshake and sessions |
| `/modern` | The stateless 2026-07-28 protocol only |
| `/dual` | Both eras; the tester picks the modern one |
| `/slow`, `/hang`, `/fail`, `/stream` | Delayed responses, timeouts, HTTP 503, event-stream tool results |
| `/secure` | OAuth sign-in end to end (for client credentials, use `cc-client` / `cc-secret`) |
| `/secure-nohint` | A 401 without a `resource_metadata` hint, so discovery probes the well-known URLs |
| `/secure-mixup` | An authorization server that returns the wrong `iss`, which the tester must reject |
| `/scenario/custom-credentials/mcp` | Client credentials under custom names: `profileID` / `secret`, with `bank-profile` / `bank-secret` |
| `/scenario/<name>/mcp` | Any named scenario, including deliberate spec violations such as `wrong-jsonrpc-version`, `id-mismatch`, `as-no-s256` and `as-issuer-mismatch` |

`GET /__scenarios` lists every scenario, and adding `?delay=<ms>` to any request makes it arrive late.

---

## When not to use MCP Tester

- **stdio servers.** A hosted or browser app can't spawn local processes, so only Streamable HTTP is supported.
- **The legacy two-endpoint HTTP+SSE transport.** It was removed because the tester was not a faithful client for it.
- **Load or performance testing.** The health monitor measures availability and latency one request at a time; it does not generate load.
- **General REST APIs.** The tester is MCP-shaped on purpose and is not a general HTTP client.
- **The hosted Worker with real credentials, as deployed by default.** It is public: put Cloudflare Access in front of it first (see [Security](#security)), or use the local server.
- **Commercial use without permission.** The licence allows noncommercial use only (see [License](#license)). Using MCP Tester at work for a company, or in a commercial product or service, needs the author's permission first.

---

## Development

```bash
make check              # every suite, the traceability check, the README check and the build: the offline CI gate
make dev                # local server; restarts on core/host changes, UI edits show on reload
make lint               # markdownlint and codespell
make mock               # mock MCP server on http://127.0.0.1:8788/mcp
npm run compliance -- http://127.0.0.1:8788/scenario/id-mismatch/mcp   # grade a server; every rule has a mock scenario that breaks it
make help               # every target; each wraps an npm script, so npm run ... works too
```

Edit `src/`, never `dist/`. The build checks its own output before writing: the HTML must round-trip exactly, `worker.js` must parse, and no module syntax may remain in the paste-able file. There is no fuzzing yet.

CI runs the tests, the traceability check and the build on Node 22 and 24, and a docs job: markdownlint, codespell, the README structure check, a check that every relative link and anchor resolves, and a strict build of the user manual. [`DEVELOPMENT.md`](DEVELOPMENT.md) covers setup, the test suites, acceptance criteria and how to reproduce every CI gate locally.

---

## Security

Report vulnerabilities privately through GitHub, as [`SECURITY.md`](SECURITY.md) describes; never in a public issue.

- **The local server is not an open proxy.** It binds to loopback. It rejects unknown `Host` headers, which blocks DNS rebinding, and it rejects `/proxy` calls from other origins. It also requires `Content-Type: application/json`, so no other web page you visit can use it to reach internal systems. It will not listen on another address without `MCP_TESTER_TOKEN`, and then every request needs the token.
- **The proxy reaches only allowed targets.** Only http and https. Loopback, private (RFC 1918), link-local, cloud metadata and other special-purpose addresses, in any spelling the URL parser accepts and including IPv4 carried in IPv6, are refused unless listed in `MCP_TESTER_ALLOWED_TARGETS`. The local server also checks the addresses a name resolves to, when it connects. Redirects are followed by the proxy, at most five, and each hop is checked the same way; a hop to another origin carries no credentials, cookies or session.
- **The Cloudflare Worker is public, and closed until configured.** Other web pages can't drive it: `/proxy` rejects foreign origins and sends no CORS grants. Since 0.10.1 it refuses every target until `MCP_TESTER_ALLOWED_TARGETS` is set, so a fresh deployment is not a fetch relay for anyone who finds its URL. Before using it:
  - Set `MCP_TESTER_ALLOWED_TARGETS` to your MCP server and authorization server hosts (or `*` for any public host).
  - Put Cloudflare Access in front of it.
  - Add a bypass for `/oauth/client-metadata.json`, so authorization servers can fetch the client metadata document.
- **Credentials stay in memory.** Auth keeps tokens and secrets in memory only and redacts them from the Log. The one exception is the pop-up fallback's in-flight request, kept in `sessionStorage` until the page returns.
- **Saved headers are stored in the browser.** The Headers dialog saves its values in `localStorage`. Use Auth for tokens and keys.
- **A Content-Security-Policy on the page**, from both hosts: it may only talk to its own origin (`connect-src 'self'`), so an injected script could not send tokens elsewhere, and it cannot be framed. The one external origin allowed is Google Fonts, for the stylesheet's fonts.
- **OAuth checks are enforced, not just reported:** issuer mismatch, the `iss` in the authorization response, `state`, and PKCE S256 support. The one exception is the opt-in **Continue past an issuer mismatch** switch for testing, which is off by default, warns while on, and still checks `iss`.
**Resource limits.** Every proxied request has a timeout, clamped to 500 ms to 120 s (default 15 s), and at most 3 retries (default 0). The local server rejects a request body over 1 MB with 413. Diagnostics keep the latest 500 samples and the Log the latest 1000 entries, so a monitor left running for days stays bounded.

**Testing and fuzzing.** The security invariants above are regression-tested: both hosts' origin checks and the local server's host and content-type checks in the hosts suite, the OAuth `iss` mix-up and PKCE end to end against the mock authorization server, and the https-only authorization endpoint in the UI-logic suite. There are no fuzz targets yet; the parsers most worth fuzzing are the SSE and JSON response handling.

**Analysis in CI.** CodeQL scans all JavaScript with its extended security queries on every change, dependency review blocks new vulnerable dependencies, `npm audit` and registry-signature checks run on every push, and OpenSSF Scorecard runs weekly on `main`.

**Supported versions.** Only the latest code on the default branch; there are no maintained release branches.

Report vulnerabilities according to [`SECURITY.md`](SECURITY.md).

---

## Documentation

- **User manual:** <https://sebastienrousseau.com/comprehensive-mcp-tester/>, published from these files on each release (`make docs` builds it locally).
- **API reference:** not applicable, as this is not a library. The one internal contract, the `/proxy` envelope, is described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Developer docs:** [`DEVELOPMENT.md`](DEVELOPMENT.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Ecosystem map:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and the decisions behind it in [`docs/adr/`](docs/adr/README.md).
- **Roadmap:** [`ROADMAP.md`](ROADMAP.md). **Changes:** [`CHANGELOG.md`](CHANGELOG.md).
- **Policies:** [`docs/POLICIES.md`](docs/POLICIES.md) (toolchain floor, versioning). **Packaging:** [`docs/packaging.md`](docs/packaging.md), for anyone repackaging the tool. **Repository standard:** [`docs/STANDARDS.md`](docs/STANDARDS.md).
- **Acceptance criteria:** [`docs/acceptance/`](docs/acceptance/README.md).

---

## Stability guarantees

MCP Tester is pre-1.0 (currently 0.0.0: nothing released yet). Releases start at 0.0.1 and each one increments the version by exactly 0.0.1 (0.0.1, 0.0.2, ...); any release may change the UI. The 0.8.0 to 0.10.0 mentioned elsewhere were pre-release numbers, never tagged or released.

**What counts as breaking.** A change is breaking when it changes what someone outside the UI relies on, even if no code signature moves:

- **The `/proxy` envelope** (fields and meanings in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#the-proxy-contract)). The UI and both hosts depend on it, so a change updates all three and their tests together.
- **`dist/worker.js` stays paste-able** into the Cloudflare dashboard (Service Worker format, no module syntax); the build fails if it isn't.
- **The configuration variables** in [Configuration](#configuration): a rename or a changed default is breaking for existing deployments.
- **The mock server's scenario names and paths**, which other projects can use to test their servers.

**Deprecation window.** Before any of these is removed or changed incompatibly, it is announced under **Deprecated** in [`CHANGELOG.md`](CHANGELOG.md) and keeps working for at least one release. The breaking change itself is listed under **Changed** or **Removed**.

**Toolchain.** The Node.js floor is the oldest LTS line still in maintenance and rises only in a release that says so; the rule and the current floor are in [`docs/POLICIES.md`](docs/POLICIES.md).

---

## License

MCP Tester is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You may use, change and share it for any noncommercial purpose: personal use, research, study, hobby projects, and use by charities, schools and universities, public research bodies and government institutions. Copies you share must include the licence (or its URL) and the `Required Notice:` line from [`LICENSE.md`](LICENSE.md).

Commercial use, including using it at work for a company, needs the author's permission. Ask [@mollerade](https://github.com/mollerade) on GitHub. The software comes as is, without warranty.
