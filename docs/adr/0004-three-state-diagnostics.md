# 0004. The diagnostics timeline uses three states

**Status:** Accepted

## Context

The health monitor's timeline colours each probe. A four-state scale (ok, slow, warning, failed) was tried, but the warning and serious status colours measured a colour difference of ΔE 13.6, below the legibility floor, so the states could not be told apart reliably. Dark-mode legibility was a specific owner complaint.

## Decision

The timeline uses three states: ok, slow and failed. The kind of failure (timeout, network, HTTP 4xx or 5xx, JSON-RPC error) is shown in tooltips and in the breakdown table, not by colour. The latency chart breaks its line across failures and draws a lone success between failures as a dot.

## Consequences

- Every state is distinguishable in both themes.
- Finding out what kind of failure happened takes a hover or a look at the table.
