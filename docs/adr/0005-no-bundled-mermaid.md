# 0005. Flow diagrams export as Mermaid text; Mermaid.js is not bundled

**Status:** Accepted (planned for roadmap item 5)

## Context

Roadmap item 5 adds a connection flow diagram (discover or initialize, the auth steps, list and call) that users will want to paste into GitHub issues and Markdown, where Mermaid renders natively. Mermaid.js is large, and loading it from a CDN would break offline use inside company networks.

## Decision

The in-app diagram is drawn as inline SVG, in the three diagnostic states. A **Copy as Mermaid** button produces Mermaid text for pasting elsewhere. Mermaid.js is neither bundled nor loaded from a CDN.

## Consequences

- The single HTML file stays small and works offline (see [0002](0002-single-file-ui.md)).
- The SVG diagram is drawn by the tester's own code, so it covers only the sequence shapes the tester needs.
