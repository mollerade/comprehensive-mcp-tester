# 0007. ESLint in its own toolchain, a shrinking complexity baseline, and no formatter

**Status:** Accepted (0.0.1)

## Context

The repository had no JavaScript linter, and the maintainer's standard asks for lint and complexity ceilings enforced in CI: cyclomatic 10, cognitive 15, 60 lines per function and 500 per file, with existing offenders in a baseline that may only shrink. The project also keeps Playwright as its only dev dependency, because corporate users audit what they install ([0002](0002-single-file-ui.md), [0006](0006-manual-with-mkdocs.md)), and #43 asked for a formatter as well.

## Decision

- **ESLint, with its own locked toolchain.** ESLint, `@eslint/js`, `eslint-plugin-sonarjs` (cognitive complexity) and `globals` live in `tools/lint/package.json` with their own lockfile, installed by `npm ci --prefix tools/lint` for linting and in CI only. The project's own install stays Playwright only. Versions are pinned exactly, each at least 7 days old when chosen, and Dependabot updates them with the same cooldown.
- **Zero findings.** `npm run lint` (`tools/lint/run.mjs`) fails on any finding, warnings included. The client files are parsed as ES5 classic scripts, so `let`, `const`, `import` and `export` fail there. Because those files share one global scope, per-file undefined and unused-variable checks are off for them; empty `catch` blocks are allowed everywhere, since the codebase uses them for best-effort calls (storage, pop-ups, history).
- **A baseline that only shrinks.** The 44 functions and files already over a ceiling when the gate arrived are listed in `tools/lint/complexity-baseline.json`, keyed by file, rule and function name. A new offender or a worse value fails; an improvement also fails until `npm run lint -- --write-baseline` records it, and that command refuses to run while anything is new or worse.
- **No formatter.** A formatter pass would rewrite nearly every line, bury the history, and conflict with every open pull request to the author's repository. `.editorconfig` and the lint rules carry the style.

## Consequences

- Linting locally needs one extra install; everything else works without it, and the lint gate's own tests skip without it outside CI.
- Halstead difficulty, part of the standard, is not measured: ESLint has no rule for it.
- The baseline is a to-do list: reducing it, worst first, is ordinary work, recorded by regenerating the file in the same change.
