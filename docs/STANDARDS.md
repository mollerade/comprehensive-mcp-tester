# Repository standard: scores and gaps

MCP Tester is measured against an eight-category repository standard, scored 1 to 10 per category:

- **1 to 3:** absent, or tribal knowledge only.
- **4 to 6:** exists but manual, partial, or not enforced in CI.
- **7 to 8:** solid and enforced, with minor gaps.
- **9:** enforced and documented with a rationale.
- **10:** a newcomer, a packager and a security auditor each get what they need without asking.

The standard is applied in six phases, one per release. This page records where the repository stands, what each gap is, and which issue owns it. Items that cannot apply to a browser tool with a small Node server say so, with the reason.

## Scores

| # | Category | Before phase 1 | After phase 1 | Owner of the remaining gaps |
| :--- | :--- | :---: | :---: | :--- |
| 1 | Identity and README | 3 | 6 | CI-checked install snippets |
| 2 | Documentation | 2 | 8 | External links not checked; migration guides not applicable |
| 3 | Build and install UX | 4 | 7 | Install snippets exercised in CI; manpages not applicable |
| 4 | Releases | 1 | 8 | First release not yet published; no native binaries (roadmap 7) |
| 5 | Packaging and distribution | 1 | 5 | Container image [#23](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/23); the noncommercial licence limits who may redistribute |
| 6 | CI quality gates | 5 | 8 | Coverage threshold; Halstead difficulty (no ESLint rule); fuzzing |
| 7 | Supply chain and security | 1 | 6 | Scorecard below 9: branch protection and code review |
| 8 | Community and governance | 2 | 9 | A CI-checked table across a repository family (not applicable to one repository) |

## Evidence by category

### 1. Identity and README

- **Has:**
  - The standard README layout: pitch, badges, contents, install, requirements, quick start, when not to use, security, documentation, stability, licence.
  - The README section order, unfilled template tokens, and any stated current version (against `package.json`) are checked in CI (`npm run check:readme`).
  - A stability section naming what counts as breaking, and a security section that leads with private reporting and states the resource limits and the fuzzing status.
  - A logo, a stated versioning rule, a deprecation window, and a rule for raising the Node floor ([`docs/POLICIES.md`](POLICIES.md)).
- **Licence:** PolyForm Noncommercial 1.0.0 ([LICENSE.md](../LICENSE.md)), chosen by the author; the badge, the README's licence section, `package.json` and `CITATION.cff` all declare it.
- **Missing, and work for later phases:** install snippets exercised in CI; a rendered manual (#53).
- **Not applicable:**
  - A registry badge, as nothing is published.
  - API documentation, as this is not a library.
  - Benchmarks and a comparison matrix: there is nothing to benchmark, and no evidence has been gathered for a comparison, so the README leaves both sections out.

### 2. Documentation

- **Has:**
  - `docs/` as the single documentation root, `DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, `docs/POLICIES.md`, `ROADMAP.md`, `CHANGELOG.md`, acceptance criteria in `docs/acceptance/`.
  - A rendered user manual built from those same files (MkDocs, pinned by hash) and published to GitHub Pages on each release tag.
  - ADRs for the settled decisions in `docs/adr/`.
  - Link checking in CI: every relative link and anchor (`make links`), and the manual's strict build.
- **Missing:** external links are not checked.
- **Not applicable:** migration guides from other tools.

### 3. Build and install UX

- **Has:**
  - The native npm flow (`npm install`, `npm test`, `npm run build`, `npm start`).
  - A zero-dependency build that checks its own output.
  - A `Makefile` wrapping the npm scripts (`make check` is the offline CI gate), and the install contract: `make install` / `make uninstall` honour `PREFIX`, `BINDIR`, `LIBDIR` and `DESTDIR`, and CI checks a staged install on every push. The installed command is tested end to end.
- **Missing:** the README's install snippets are not exercised in CI.
- **Not applicable:** manpages and shell completions, since there is no CLI with flags.

### 4. Releases

- **Has:**
  - `CHANGELOG.md`, and a release procedure in `DEVELOPMENT.md`.
  - A tag-triggered release workflow with a dry run that runs on every change to the release machinery.
  - A blocking preflight: the tag must be annotated, signed and verified, carry the message `MCP Tester vX.Y.Z`, point at `main`, and match every version reference and the changelog.
  - `SHA256SUMS`, a CycloneDX SBOM, and Sigstore-signed build provenance and SBOM attestations for every file.
  - Release notes in a fixed layout, and an audit that reads the published release back.
- **Missing:**
  - A published release: 0.8.0 to 0.10.0 were never tagged, and 0.10.1 will be the first.
  - Native binaries, which are roadmap item 7 (#26).

### 5. Packaging and distribution

- **Has:**
  - `docs/packaging.md` for repackagers: the two shapes, toolchain, the no-runtime-dependency model, offline build and tests, install layout, and how to verify a build.
  - A reproducible build, checked in CI on every push: the same commit gives byte-identical files on Linux and macOS, with Node 22 and 24.
- **Missing:** a container image, which is roadmap item 6 (#23). Redistribution is allowed for noncommercial purposes only.
- **Not applicable yet:**
  - deb, rpm, AUR, Homebrew and Nix packages, and Repology tracking. The product is a web page plus a small server; revisit with the desktop builds (#26).
  - C-FFI.

### 6. CI quality gates

- **Has:**
  - ESLint at zero findings, with the complexity ceilings (cyclomatic 10, cognitive 15, 60 lines per function, 500 per file) enforced and a baseline of existing offenders that may only shrink ([ADR 0007](adr/0007-lint-gate.md)).
  - Every suite, end-to-end with Chromium included, on Node 22 and 24.
  - The acceptance-criteria traceability check.
  - The build self-checks.
  - Markdown lint and spelling.
- **Missing:**
  - A coverage threshold.
  - An OS matrix.
  - JUnit reports (#6).
- **Not applicable:** fuzzing corpora and an API-breakage check. The one input parser, the SSE and JSON handling, could gain fuzz tests later.

### 7. Supply chain and security

- **Has:**
  - `SECURITY.md` with GitHub private vulnerability reporting.
  - Release files with a CycloneDX SBOM and Sigstore-signed build provenance, verifiable with `gh attestation verify`.
  - The manual's Python tooling pinned by hash.
  - Dependabot for npm and GitHub Actions.
  - The lockfile committed and `npm ci` in CI.
  - No runtime dependencies.
- **Missing:**
  - Actions pinned by commit SHA; the new docs-lint job's actions are pinned, the older ones are not.
  - An OpenSSF Scorecard run.
  - `npm audit` in CI.
  - REUSE / SPDX headers per file (#56).
- **Not applicable:** `KEYS.asc`. Tags are signed with the maintainer's SSH key, which GitHub verifies against the key registered on their account, and release files carry Sigstore attestations instead of key signatures.

### 8. Community and governance

- **Has:** `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` (with the acceptance-criteria convention), issue and pull request templates, `.editorconfig`, and a docs-lint CI job.
- **Missing:**
  - `GOVERNANCE.md` and `SUPPORT.md`.
  - `CITATION.cff`.
  - A pre-commit config.
  - A devcontainer.
  - An `AGENTS.md`; the agent rules live in `CLAUDE.md` today (#56).

## Phases

| Phase | Ships | Issue | State |
| :--- | :--- | :--- | :--- |
| 1 | Normalised layout: `docs/` root, `DEVELOPMENT.md`, community files, docs-lint CI | This change | Done |
| 2 | Makefile and install UX | [#52](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/52) | Done |
| 3 | Rendered manual and link check | [#53](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/53) | Done |
| 4 | Automated, signed releases | [#54](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/54) | Done |
| 5 | Packaging | [#55](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/55) | Done |
| 6 | Polish: Scorecard, pinned actions, devcontainer, governance files | [#56](https://github.com/sebastienrousseau/comprehensive-mcp-tester/issues/56) | Done |
