# Contributing to MCP Tester

Thank you for helping. This page covers how to propose a change; [DEVELOPMENT.md](DEVELOPMENT.md) covers setup and running the checks.

Before you start: the project has no licence yet ([#51](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/51)). Until the author chooses one, contributions cannot be accepted under clear terms, so please check that issue first.

## Reporting bugs and asking for features

- **Security problems:** never in a public issue. Follow [SECURITY.md](SECURITY.md).
- **Bugs and features:** open an issue with the matching template. For a bug, include the server's protocol era if you know it, what you did, and the relevant Log entries (tokens are redacted there already).

## Making a change

1. Work on a branch, one change per pull request.
2. Keep the architecture rules in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): `src/core/` stays platform-free, hosts stay thin adapters, the UI ships as one HTML file, and client JS stays ES5-style classic scripts.
3. No new runtime dependencies. Corporate users audit what they install; a new dev dependency needs a strong reason stated in the pull request.
4. Add or adjust tests with every behaviour change, and run `make check` and `npm run lint` before you push (see [DEVELOPMENT.md](DEVELOPMENT.md#ci-gates-and-how-to-run-them-locally)). `pre-commit install` runs the fast checks on every commit, and the devcontainer (`.devcontainer/`) gives you a ready environment.
5. After a UI change, check the light and dark themes and a width of about 400px.
6. Add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

Commit messages use [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`, `test:` ...), with a body that says what changed and why. Fill in the pull request template: what it does, why, and how you verified it.

## Acceptance criteria and regression tests

Behaviour is specified before it is built, and every specified behaviour is locked in by a test.

- **AC ID format:** `AC-<ISSUE-KEY>-<NN>`, for example `AC-QA-TRACE-01`. The issue key comes from the issue's footer.
- **Where they live:** copy the issue's criteria into `docs/acceptance/v<milestone>/<ISSUE-KEY>.feature` as Gherkin scenarios, one per criterion, tagged with the ID and the target suite:

  ```gherkin
  @AC-QA-TRACE-01 @suite:tooling
  Scenario: Covered AC passes
    Given ...
    When ...
    Then ...
  ```

- **Test title convention:** the test that covers a criterion starts its title with the ID: `test('AC-QA-TRACE-01: covered AC passes', ...)`.
- **Criteria for a later milestone** can be tagged `@pending` until their test exists; they fail the check once `package.json` reaches that milestone.
- **Enforcement:** `npm run test:trace` runs in CI and fails on a criterion without a test, a test naming an unknown criterion, or a duplicated ID.

## Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Maintainers

Roles and how decisions are made are in [GOVERNANCE.md](GOVERNANCE.md).

- [@mollerade](https://github.com/mollerade), the author.
- [@sebastienrousseau](https://github.com/sebastienrousseau), who maintains the fork where the roadmap issues are tracked.
