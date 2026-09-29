# 0002. The UI ships as one self-contained HTML file

**Status:** Accepted (0.8.0)

## Context

The Worker must be deployable by pasting one file into the Cloudflare dashboard, and the owner uses the tool from an iPad as well as a Mac. A bundler would add a build dependency and a toolchain for contributors.

## Decision

`src/ui/assemble.js` inlines `styles.css` and the client JS into one HTML page; every host serves that one string, and the Worker embeds it. The client JS files are classic scripts sharing one global scope, concatenated in `src/ui/js/ORDER.json` order, not ES modules. They are written ES5-style (`var`, `function`, string concatenation) to run on older iPad Safari. The build has zero dependencies.

## Consequences

- No bundler and no runtime dependencies; `dist/worker.js` pastes into the dashboard as is, and the build checks that it still does.
- Top-level statements may live only in `state.js` (first) and `main.js` (last); everything else is function declarations, and a new file must be added to `ORDER.json`.
- Client code can't use modern syntax or modules; server-side code (core, hosts, build, tests) can.
