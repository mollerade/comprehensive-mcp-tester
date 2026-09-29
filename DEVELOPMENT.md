# Development

Everything needed to work on MCP Tester: setup, the layout, the test suites, and how to run every CI gate locally. For what the project is, start with the [README](README.md); for how to propose a change, [CONTRIBUTING.md](CONTRIBUTING.md).

## Setup

- Node.js 20 or later (see [`docs/POLICIES.md`](docs/POLICIES.md)).
- `npm install`. Playwright is the only dependency, and only for the end-to-end tests.
- For the end-to-end tests, a Chromium build: `npx playwright install chromium`, or point `PW_CHROMIUM_PATH` at one. Without it those tests skip rather than fail.

```sh
npm run dev             # local server on http://127.0.0.1:8787; restarts on core/host changes, UI edits show on reload
npm run mock            # mock MCP server on http://127.0.0.1:8788/mcp
npm test                # all suites
npm run test:trace      # acceptance-criteria traceability
npm run check:readme    # README structure check
npm run build           # regenerate dist/
```

Edit `src/`, never `dist/`: `dist/` is generated and ignored by git. How the pieces fit is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Test suites

`npm test` runs every suite with Node's built-in runner:

- **proxy**: the core against a mock server. Covers timing, timeouts, retries with backoff, network failures, Accept repair, header filtering and the allowlist. It also covers the mock server's scenario registry: discovery, the original paths as aliases, parallel instances, the delay knob, and that each violation scenario breaks the rule it names.
- **hosts**: both Cloudflare bundles, executed as built, and the local server, including its security checks.
- **ui-logic**: the shipped client JS in a VM. Covers the percentile and uptime maths, flap streaks, schema-based request suggestions and JSON-RPC ids.
- **e2e**: Chromium drives the real UI through the local server to the mock MCP server. Covers both protocol eras, OAuth sign-in (pop-up and redirect), the `iss` mix-up rejection, client credentials, connect, filter, suggested requests, form and JSON execution, error responses, resources, prompts, log, diagnostics, theme, saved servers, timeouts and phone-width layout.
- **tooling**: the repository's own scripts (the traceability check, the README check, the governance files) run as real processes or against throwaway fixture trees.

The mock server (`tests/fixtures/mock-mcp-server.mjs`) should fail the same ways real servers do. New misbehaviour is a new scenario in `tests/fixtures/mock/scenarios/`, served on `/scenario/<name>/mcp`, not a new top-level path. `startMock({ port: 0 })` gives each test its own instance.

## Acceptance criteria

Every roadmap issue states its behaviour as Given/When/Then acceptance criteria with stable IDs. They live as tagged Gherkin scenarios in `docs/acceptance/v<milestone>/<ISSUE-KEY>.feature`, and a test covers one when its title starts with the ID:

```js
test('AC-QA-TRACE-01: covered AC passes', () => { /* ... */ });
```

`npm run test:trace` fails on a criterion with no test, a test naming an unknown criterion, a duplicated ID, or an `@pending` criterion still untested once `package.json` reaches its milestone. `--format=json` prints the same report as JSON.

## CI gates, and how to run them locally

| CI job | What it checks | Locally |
| :--- | :--- | :--- |
| Test (Node 20, 22) | Every suite, including e2e with Chromium | `npm test` |
| Test (Node 20, 22) | Every acceptance criterion has a test | `npm run test:trace` |
| Test (Node 20, 22) | The build and its self-checks | `npm run build` |
| Docs lint | Markdown style | `npx markdownlint-cli2 "**/*.md"` |
| Docs lint | Spelling | `codespell` (from `pip install codespell`) |
| Docs lint | README section order, no unfilled template tokens | `npm run check:readme` |

The docs-lint tools run in CI only; they are not project dependencies.

## Releases

There is no release pipeline yet: versions 0.8.0 to 0.10.0 were not tagged, and CI uploads `dist/` as the `mcp-tester-dist` artifact on every run. Automated, signed releases are tracked in [#54](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/54). Record user-visible changes in [`CHANGELOG.md`](CHANGELOG.md) under `Unreleased` as you make them.

## Deploying to Cloudflare by hand

Paste `dist/worker.js` into the Worker's dashboard editor, selecting and deleting all existing code first. A paste on top of leftover code once caused a confusing `Unexpected identifier` error.
