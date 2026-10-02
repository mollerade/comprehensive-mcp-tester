# Changelog

All notable changes to MCP Tester are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is pre-1.0, so any release may change behaviour (see [Stability guarantees](README.md#stability-guarantees)).

Releases 0.8.0 to 0.10.0 were not tagged; their dates are those of the commits that set each version.

## [Unreleased]

### Security

- **The proxy reaches only allowed targets.** It accepts http and https only, and refuses loopback, private, link-local, cloud-metadata and other special-purpose addresses (IPv4 and IPv6, in every spelling the URL parser normalises, including IPv4 carried in IPv6, 6to4 and NAT64) unless their host or exact origin is listed in `MCP_TESTER_ALLOWED_TARGETS`. The local server also checks the addresses a name resolves to in the socket's own lookup, so DNS rebinding cannot slip past the check.
- **Redirects no longer bypass the allowlist.** The proxy follows redirects itself, at most five, and checks every hop; a refused hop is a 403 and is never fetched or retried. A 303 (or a 301/302 after a POST) continues as a GET without a body, and a hop to another origin carries only protocol headers, never `Authorization`, cookies or the session.
- **The local server will not listen beyond loopback without `MCP_TESTER_TOKEN`** (32 or more characters). With a token, every request needs it: the printed access link sets an HttpOnly, SameSite=Lax cookie holding an HMAC of the token, and scripts send `Authorization: Bearer`.

### Added

- `npm run test:ci`: every suite with a JUnit report per Node version; CI uploads the reports and lists failing tests by acceptance criterion in the job summary. The e2e suite fails instead of skipping when Chromium is missing and `CI=true`, and every CI job has a timeout of 15 minutes or less ([#6](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/6)).
- A lint gate: ESLint in CI at zero findings, the client held to ES5 classic scripts, and the complexity ceilings enforced with a baseline of existing offenders that may only shrink. ESLint installs from `tools/lint`, so the project's own install stays Playwright only ([#43](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/43)).
- A Content-Security-Policy on the page from both hosts: requests only to its own origin, no framing, no rebasing or posting forms elsewhere ([#41](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/41)).
- CodeQL, OpenSSF Scorecard, dependency review, `npm audit` and registry-signature checks in CI, with every GitHub Action pinned by commit; a devcontainer checked in CI to boot to a green test suite; a pre-commit configuration; `AGENTS.md` (which `CLAUDE.md` now imports), `GOVERNANCE.md`, `SUPPORT.md` and `CITATION.cff`. ([#56](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/56)).
- `docs/packaging.md` for anyone repackaging the tool, and a CI check that the build is reproducible: the same commit gives byte-identical files ([#55](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/55)).
- A user manual built from the repository's Markdown and published to GitHub Pages on each release, architecture decision records in `docs/adr/`, and a CI check that every relative link and anchor resolves ([#53](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/53)).
- A `Makefile`: `make check` runs the offline CI gate, and `make install` / `make uninstall` install the local server as an `mcp-tester` command, honouring `PREFIX` and `DESTDIR` ([#52](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/52)).
- Acceptance-criteria traceability check, `npm run test:trace`: every criterion in `docs/acceptance/` needs a test titled with its ID, and CI runs it ([#4](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/4)).
- Mock server scenario registry: every behaviour is a named scenario on `/scenario/<name>/mcp`, listed by `GET /__scenarios`, with seven deliberate spec violations, a `?delay=<ms>` knob and `startMock({ port: 0 })` for tests ([#5](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/5)).
- The spec compliance rule engine (`src/core/compliance/`): rules as data, graded against the protocol version the server claims; the build now fails if `src/core/` reaches for a platform-specific API ([#9](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/9)).
- A logo, and stated policies for versioning (every release is +0.0.1), deprecation (announced, then kept for at least one release) and the Node.js floor (the oldest LTS still in maintenance), in `docs/POLICIES.md`.
- `ROADMAP.md`, `CHANGELOG.md`, `DEVELOPMENT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `docs/ARCHITECTURE.md`, `docs/POLICIES.md`, `docs/STANDARDS.md`, issue and PR templates, Dependabot, and a docs-lint CI job.

### Changed

- **The Cloudflare Worker is closed by default.** It refuses every target until `MCP_TESTER_ALLOWED_TARGETS` is set (`*` for any public host); before, an unset allowlist made a fresh deployment an open fetch relay. **Set the variable before redeploying.** `ALLOWED_ORIGINS` still works as the older name, and now also accepts exact origins.
- On the local server, a loopback or private target, such as the mock server, must now be listed: `MCP_TESTER_ALLOWED_TARGETS=http://127.0.0.1:8788 npm start`.
- **Node.js 22 or later is now required** (was 20). Node 20 reached end of life on 2026-04-30; CI now tests Node 22 and 24 ([#58](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/58)).
- README restructured into the standard layout; the roadmap moved to `ROADMAP.md`.

### Fixed

- A refusal from the proxy itself (a target outside its allowlist) was shown as a successful, empty response. It is now a failed call that carries the proxy's reason and hint, and is never mistaken for a sign-in challenge.

- The Dependency review job failed outright on a repository whose dependency graph is switched off. It now checks first and, only when the API answers 404, skips the review with a warning annotation and a job-summary line; any other API error still fails the job.
- Six CodeQL findings: the parsed OAuth callback kept every query parameter, `__proto__` included, and now keeps only the authorization response's (`code`, `state`, `iss`, `error`, `error_description`, `error_uri`), a backslash in an error could break the diagnostics report's Markdown table, and the local server's 500 response echoed the internal error message (now logged in the terminal instead). In the mock server, the Basic-auth pattern could backtrack, `?delay=` is clamped with an explicit comparison, and a broken scenario's error goes to the test output rather than the response.
- The manual's CI build failed when a pinned Python package had been released minutes earlier and a PyPI mirror had not caught up; the install now retries, and Dependabot proposes updates only after a 7-day cooldown.
- The trace, README and link checks, the build and the mock server silently exited 0 without doing anything when run from a path that goes through a symlink; a check could pass without having run ([#62](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/62)).
- With pop-ups blocked, sign-in saved a client secret, if one was entered, in `sessionStorage` across the redirect. It is no longer saved; a sign-in that needs it asks for it again on return ([#42](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/42)).
- The request Log kept every entry, so a health monitor left running grew memory and re-render cost without bound; it now keeps the newest 1000 ([#40](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/40)).
- The local server silently exited without starting when run from a path that goes through a symlink (for example macOS's `/tmp` or a Homebrew prefix), and with `PORT=0` it announced port 0 instead of the port it bound.
- `package-lock.json` recorded the project as version 0.8.0; it now matches `package.json` (0.10.0).
- A late response from a previous connection no longer overwrites the current server's tools, session, auth challenge or diagnostics, and a disconnect drops in-flight work ([#39](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/39)).
- The OAuth flow refuses a non-https authorization endpoint (http only on loopback), so a hostile authorization server cannot send the pop-up to a `javascript:` or `data:` URL ([#38](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/38)).
- Untrusted MCP schema names are escaped in form field ids, closing a DOM-XSS path ([#37](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/37)).
- The OAuth end-to-end tests no longer fail intermittently in CI ([#36](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/36)).

## [0.10.0] - 2026-09-25

### Added

- Authentication per the MCP 2026-07-28 authorization spec: 401/403 challenge, protected resource and authorization server metadata discovery, CIMD and DCR registration, authorization code with PKCE and the `iss` check, `resource` on every request; bearer, API-key header and client credentials modes.
- Pop-up sign-in with a redirect fallback that resumes on `/oauth/callback`.

### Changed

- The Cloudflare Worker is no longer an open CORS proxy: `/proxy` rejects foreign origins and sends no CORS grants.

## [0.9.0] - 2026-09-25

### Added

- The 2026-07-28 stateless protocol (`server/discover`, per-request `_meta`, mirrored headers), with fallback to the `initialize` handshake.

## [0.8.0] - 2026-09-25

### Added

- First release: one codebase served as a Cloudflare Worker and a local Node server, with the MCP proxy core, the single-file UI, diagnostics and the health monitor.

[Unreleased]: https://github.com/mollerade/comprehensive-mcp-tester/compare/73359a7...HEAD
[0.10.0]: https://github.com/mollerade/comprehensive-mcp-tester/commit/73359a7
[0.9.0]: https://github.com/mollerade/comprehensive-mcp-tester/commit/f15ce72
[0.8.0]: https://github.com/mollerade/comprehensive-mcp-tester/commit/5bc37f5
