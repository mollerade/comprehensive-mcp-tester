# Changelog

All notable changes to MCP Tester are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is pre-1.0, so any release may change behaviour (see [Stability guarantees](README.md#stability-guarantees)).

Releases 0.8.0 to 0.10.0 were not tagged; their dates are those of the commits that set each version.

## [Unreleased]

### Added

- Acceptance-criteria traceability check, `npm run test:trace`: every criterion in `docs/acceptance/` needs a test titled with its ID, and CI runs it ([#4](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/4)).
- Mock server scenario registry: every behaviour is a named scenario on `/scenario/<name>/mcp`, listed by `GET /__scenarios`, with seven deliberate spec violations, a `?delay=<ms>` knob and `startMock({ port: 0 })` for tests ([#5](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/5)).
- A logo, and stated policies for versioning (every release is +0.0.1), deprecation (announced, then kept for at least one release) and the Node.js floor (the oldest LTS still in maintenance), in `docs/POLICIES.md`.
- `ROADMAP.md`, `CHANGELOG.md`, `DEVELOPMENT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `docs/ARCHITECTURE.md`, `docs/POLICIES.md`, `docs/STANDARDS.md`, issue and PR templates, Dependabot, and a docs-lint CI job.

### Changed

- README restructured into the standard layout; the roadmap moved to `ROADMAP.md`.

### Fixed

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
