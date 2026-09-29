# Policies

## Minimum toolchain

| What | Floor | Where it is set | Enforced by |
| :--- | :--- | :--- | :--- |
| Node.js (local server, build, tests) | 20 | `engines` in `package.json` | CI runs every suite on Node 20 and 22 |
| Browser (the UI) | Older iPad Safari | Client JS is ES5-style by rule | Review; no automated check yet |

The Node floor is 20 because that is the oldest version CI tests. No rule is agreed yet for when it may rise; until one is, the floor changes only together with the CI matrix, `engines`, this table and a `CHANGELOG.md` entry.

No compatibility is claimed with any distribution's packaged Node.js.

## Versioning

The project is pre-1.0. Releases so far went 0.8.0, 0.9.0, 0.10.0, each adding one roadmap item, and none was tagged. Pre-1.0, any release may change behaviour; see [Stability guarantees](../README.md#stability-guarantees). How versions increase from here, and the release check that enforces it, is tracked in [#7](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/7).

## Dependencies

No runtime dependencies. Playwright is the only dev dependency, for the end-to-end tests. Corporate users audit what they install, so adding any package needs a strong reason stated in the pull request. Dependabot keeps the dev dependency and the CI actions current.
