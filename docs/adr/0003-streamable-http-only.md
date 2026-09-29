# 0003. Streamable HTTP is the only transport

**Status:** Accepted

## Context

Earlier versions offered an "SSE" option, but it was not a faithful client for the legacy HTTP+SSE transport, whose handshake opens a GET stream and waits for an `endpoint` event. stdio servers need a local process to be spawned.

## Decision

The tester speaks Streamable HTTP only; the SSE option was removed. Streamable HTTP already accepts either JSON or event-stream responses. stdio is out of scope. The client is dual-era within Streamable HTTP: it tries the 2026-07-28 stateless protocol first and falls back to the `initialize` handshake.

## Consequences

- One transport to get right, and no option that looks supported but behaves wrongly.
- Legacy two-endpoint HTTP+SSE servers and stdio servers can't be tested; the README lists both under "When not to use".
