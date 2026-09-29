# 0006. The user manual is built with MkDocs 1.x and Material, pinned

**Status:** Accepted (0.10.1)

## Context

The repository standard asks for a rendered user manual built from the Markdown already in the repository and published on each release. For a Node project the usual tools are Docusaurus or VitePress, but either would add npm dev dependencies, and the project keeps Playwright as its only one because corporate users audit what they install (see [0002](0002-single-file-ui.md)). In February 2026 the Material for MkDocs maintainers warned that MkDocs 2.0 drops plugins and themes with no migration path, and that Material 9.x caps MkDocs below 2.0 for that reason.

## Decision

The manual is built with MkDocs 1.6.1 and Material for MkDocs 9.7.7, installed with pip in CI and for `make docs` only, never as a project dependency. `docs/manual/requirements.txt` pins every package by version and hash, and the build runs with `--strict`. The chapters are the repository's own Markdown files, staged with their paths intact, not copies. The configuration uses the theme and standard Markdown extensions only, no MkDocs plugins.

## Consequences

- No new npm dependency; the npm install stays Playwright only.
- Contributors who want to build the manual locally need Python and one `pip install`; everything else works without it.
- If MkDocs 1.x stops being viable, Zensical, which its authors describe as a drop-in replacement that builds existing MkDocs 1.x projects, is the planned exit. Using no plugins keeps that move small.
