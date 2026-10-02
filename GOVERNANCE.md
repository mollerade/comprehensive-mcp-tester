# Governance

How decisions are made in MCP Tester today. It is a small project, and this page describes how it actually runs rather than a process it aspires to.

## Roles

- **Author: [@mollerade](https://github.com/mollerade).** Created the project and holds its copyright. Decides what only the owner can: the licence (PolyForm Noncommercial 1.0.0, see [LICENSE.md](LICENSE.md)) and permission for commercial use, the product's direction, and whether a change from the fork is taken into [mollerade/comprehensive-mcp-tester](https://github.com/mollerade/comprehensive-mcp-tester).
- **Fork maintainer: [@sebastienrousseau](https://github.com/sebastienrousseau).** Maintains [sebastienrousseau/comprehensive-mcp-tester](https://github.com/sebastienrousseau/comprehensive-mcp-tester), where the roadmap issues are tracked, reviews and merges pull requests there, cuts releases, and offers each merged change to the author's repository as a pull request.
- **Contributors.** Anyone proposing an issue or a pull request, following [CONTRIBUTING.md](CONTRIBUTING.md).

## How a change lands

1. It is proposed as an issue or a pull request, with acceptance criteria for new behaviour.
2. CI must pass: every test suite on Node 22 and 24, the traceability, README and link checks, the reproducible build, the docs lint, CodeQL, and dependency review.
3. A maintainer merges it into the current release branch, `feat/v<next-version>`. Only the release pull request merges into `main`.
4. A release is cut from `main` with a signed tag, as [DEVELOPMENT.md](DEVELOPMENT.md#releases) describes.
5. The change is then offered to the author's repository, where merging it is the author's decision.

## How decisions are recorded

- Design decisions that shape the project and would otherwise be questioned again become architecture decision records in [`docs/adr/`](docs/adr/README.md). A record is superseded by a new one, never rewritten.
- Policies (versioning, the toolchain floor, dependencies) are in [`docs/POLICIES.md`](docs/POLICIES.md).
- The agreed order of work is [`ROADMAP.md`](ROADMAP.md).

## Changing this document

Like any other change: a pull request, merged by a maintainer. A change to the roles above needs the agreement of the person whose role changes.
