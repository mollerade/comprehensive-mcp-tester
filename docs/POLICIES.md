# Policies

## Minimum toolchain

| What | Floor | Where it is set | Enforced by |
| :--- | :--- | :--- | :--- |
| Node.js (local server, build, tests) | 20 | `engines` in `package.json` | CI runs every suite on Node 20 and 22 |
| Browser (the UI) | Older iPad Safari | Client JS is ES5-style by rule | Review; no automated check yet |

**The rule.** The floor is the oldest Node.js LTS line still receiving maintenance updates, per the [Node.js release schedule](https://github.com/nodejs/Release#release-schedule). CI tests the floor and the active LTS. The floor rises only in a release whose `CHANGELOG.md` entry says so, together with `engines`, the CI matrix and this table.

**Today.** Node 20 reached end of life on 2026-04-30, so under this rule the floor rises to 22 (maintained until 2027-04-30), with 24 as the active LTS. That raise is [#58](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/58); until it ships, the floor stated everywhere is still 20.

No compatibility is claimed with any distribution's packaged Node.js.

## Versioning

**History.** Releases 0.8.0, 0.9.0 and 0.10.0 each added one roadmap item; none was tagged.

**From here, every release increments by exactly 0.0.1:** 0.10.0, then 0.10.1, 0.10.2, and so on. The next minor number is reached only by passing through 0.x.999. Work for the next release happens on a branch named `feat/v<next-version>` (for example `feat/v0.10.1`), which is the only pull request open against `main`; other branches merge into it. A release check that enforces the increment is [#7](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/7).

**Deprecation.** A feature, configuration variable, mock scenario or `/proxy` field is deprecated before it is removed: the deprecation is announced under **Deprecated** in `CHANGELOG.md`, and the item keeps working for at least one release after that. The removal is then listed under **Removed**.

Pre-1.0, any release may still change behaviour; see [Stability guarantees](../README.md#stability-guarantees).

## Dependencies

No runtime dependencies. Playwright is the only dev dependency, for the end-to-end tests. Corporate users audit what they install, so adding any package needs a strong reason stated in the pull request. Dependabot keeps the dev dependency and the CI actions current.
