@issue:10
Feature: Compliance rules for JSON-RPC, transport and lifecycle, in both eras
  As someone testing an MCP server,
  I want the tester to probe the server and grade its JSON-RPC messages, its Streamable HTTP behaviour and its handshake,
  so that I learn which protocol rules it breaks, with the evidence, before a client does.

  @AC-SPEC-RPC-01 @suite:compliance
  Scenario: Correct servers pass
    Given the mock's correct session-era, stateless and dual-era servers, and one that pages
    When the collector probes them and the engine grades the recording
    Then no rule fails, warns or errors, the verdict is pass, and paging is graded when the server pages

  @AC-SPEC-RPC-02 @suite:compliance
  Scenario: Each protocol rule is broken by its scenario
    Given one mock scenario per JSON-RPC, transport, session, lifecycle, version and result rule
    When each is graded
    Then exactly the rules that scenario breaks fail or warn, each with a message saying what was wrong

  @AC-SPEC-RPC-03 @suite:compliance
  Scenario: The probes follow the server's era and stay MCP-shaped
    Given a session-era server and a stateless one
    When the collector probes them
    Then it uses initialize and session probes for the first, server/discover and version probes for the second
    And it never calls a tool, reads a resource or gets a prompt

  @AC-SPEC-RPC-04 @suite:compliance
  Scenario: A server that is unreachable or refuses the handshake is not graded
    Given a server that refuses the connection, and one that answers 401 to every handshake
    When the check runs
    Then the recording says why no handshake succeeded, no rule fails or errors, and the report suggests --header
    And with a valid token the second server is graded as usual

  @AC-SPEC-RPC-05 @suite:compliance
  Scenario: Extra headers are sent but never recorded
    Given an extra header such as an API key
    When the collector probes the server
    Then every probe carries it, except the one handshake sent without it to look for an authorization challenge
    And the recording does not contain it

  @AC-SPEC-RPC-06 @suite:compliance
  Scenario: The check runs from the command line
    Given npm run compliance -- <url>
    When the server passes, fails, cannot be reached, or the arguments are wrong
    Then it prints a Markdown (or --json) report and exits 0, 1, 1 or 2
