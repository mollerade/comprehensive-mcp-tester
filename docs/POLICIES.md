# Policies

## Minimum toolchain

| What | Floor | Where it is set | Enforced by |
| :--- | :--- | :--- | :--- |
| Node.js (local server, build, tests) | 22 | `engines` in `package.json` | CI runs every suite on Node 22 and 24 |
| Browser (the UI) | Older iPad Safari | Client JS is ES5-style by rule | Review; no automated check yet |

**The rule.** The floor is the oldest Node.js LTS line still receiving maintenance updates, per the [Node.js release schedule](https://github.com/nodejs/Release#release-schedule). CI tests the floor and the active LTS. The floor rises only in a release whose `CHANGELOG.md` entry says so, together with `engines`, the CI matrix and this table.

**Today.** The floor is 22 (maintained until 2027-04-30) and the active LTS is 24. It rose from 20 when Node 20 reached end of life on 2026-04-30 ([#58](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/58)). Node 22 leaves maintenance on 2027-04-30, when the floor rises to 24.

No compatibility is claimed with any distribution's packaged Node.js.

## Versioning

**History.** Before releases started, the version in the files went 0.8.0, 0.9.0, 0.10.0, one step per roadmap item. None of those was tagged or released, so they are pre-release numbers, and numbering restarted when the project adopted this policy.

**Releases start at 0.0.1, and every release increments by exactly 0.0.1:** 0.0.1, 0.0.2, and so on. 0.1.0 is reached only by passing through 0.0.999. Until the first release, the files say 0.0.0; the release commit sets the version being released. Work for the next release happens on a branch named `feat/v<next-version>` (for example `feat/v0.0.1`), which is the only pull request open against `main`; other branches merge into it. A release check that enforces the increment is [#7](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/7).

**Deprecation.** A feature, configuration variable, mock scenario or `/proxy` field is deprecated before it is removed: the deprecation is announced under **Deprecated** in `CHANGELOG.md`, and the item keeps working for at least one release after that. The removal is then listed under **Removed**.

Pre-1.0, any release may still change behaviour; see [Stability guarantees](../README.md#stability-guarantees).

## Dependencies

No runtime dependencies. Playwright is the only dev dependency, for the end-to-end tests. Corporate users audit what they install, so adding any package needs a strong reason stated in the pull request. Dependabot keeps the dev dependency and the CI actions current.
