# Architecture decision records

Decisions that shape MCP Tester and would otherwise be questioned again. Each record says what was decided, why, and what it costs. They were written down on 2026-09-29; the decisions themselves were made while building 0.8.0 to 0.10.0 or planning the roadmap, and are recorded as the project's own documents state them.

| # | Decision | Status |
| :--- | :--- | :--- |
| [0001](0001-proxy-through-the-host.md) | The page reaches MCP servers only through its host's `/proxy` | Accepted |
| [0002](0002-single-file-ui.md) | The UI ships as one self-contained HTML file | Accepted |
| [0003](0003-streamable-http-only.md) | Streamable HTTP is the only transport | Accepted |
| [0004](0004-three-state-diagnostics.md) | The diagnostics timeline uses three states | Accepted |
| [0005](0005-no-bundled-mermaid.md) | Flow diagrams export as Mermaid text; Mermaid.js is not bundled | Accepted |
| [0006](0006-manual-with-mkdocs.md) | The user manual is built with MkDocs 1.x and Material, pinned | Accepted |

## Adding a record

Copy the shape of an existing record into `NNNN-short-title.md` with the next number: **Status**, **Context**, **Decision**, **Consequences**. A record is never edited to reverse it; a new record supersedes it, and the old one's status says so.
