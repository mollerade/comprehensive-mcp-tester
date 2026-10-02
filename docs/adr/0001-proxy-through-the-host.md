# 0001. The page reaches MCP servers only through its host's `/proxy`

**Status:** Accepted (0.8.0)

## Context

Browsers can't call most MCP servers directly, because the servers don't send CORS headers. The tester also has to run in two very different places: as a public Cloudflare Worker, and as a local server inside company networks.

## Decision

The page never talks to an MCP server itself. It posts every request to its own host's `/proxy` route, and the host forwards it server-side. The proxy logic lives in `src/core/proxy.js` with no platform code; each host (`src/hosts/cloudflare.js`, `src/hosts/node-server.js`) is a thin adapter that injects `fetch`, the allowlist and the location. The `/proxy` envelope is a contract between the UI and every host.

## Consequences

- Any server is reachable regardless of its CORS headers, and every exchange can be timed and diagnosed in one place.
- A new way to run the tool (Docker, desktop) is a new adapter, not a change to the UI or the proxy.
- The proxy is a security boundary: the local server must not become an open proxy (loopback binding, `Host` and `Origin` checks, JSON-only), and the Worker must not become an open CORS proxy.
- A change to the envelope must update both hosts and their tests together.
