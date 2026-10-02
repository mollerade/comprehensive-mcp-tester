Feature: The proxy reaches only the targets its operator allows
  As someone running MCP Tester inside a company network or as a public Worker,
  I want the proxy to refuse internal addresses, unchecked redirects and anonymous use,
  so that it cannot be turned into a relay into my network or for anyone on the internet.

  @AC-SEC-PROXY-01 @suite:proxy
  Scenario: A redirect to a target outside the policy is refused and never fetched
    Given an allowed server that answers 307 with a Location on another, unlisted origin
    When the proxy forwards a request to it, with retries
    Then the proxy answers 403 naming the refused redirect
    And the second origin receives no request, and the first is asked only once

  @AC-SEC-PROXY-02 @suite:proxy
  Scenario: Redirects inside the policy are followed, without credentials across origins
    Given a server that redirects to another listed origin
    When the proxy follows it
    Then the final response is returned with the hops in the diagnostics
    And the hop to the other origin carries no Authorization, Cookie or Mcp-Session-Id
    And a 303, or a 301/302 after a POST, continues as a GET without a body

  @AC-SEC-PROXY-03 @suite:proxy
  Scenario: A redirect loop stops after five hops
    Given a server that always redirects to itself
    When the proxy follows it
    Then it answers 502 "Too many redirects" after five hops

  @AC-SEC-PROXY-04 @suite:proxy
  Scenario: Special-purpose addresses are refused unless listed, in every spelling
    Given no target list
    When the target is loopback, private, link-local, cloud metadata, IPv4-mapped or NAT64 IPv6, or localhost, written in any form the URL parser accepts
    Then the proxy answers 403 without fetching
    And the same address is fetched once its host or exact origin is listed

  @AC-SEC-PROXY-05 @suite:proxy
  Scenario: Only http and https targets
    Given a target with another scheme, or with a user name in the URL
    When the proxy is asked to fetch it
    Then it answers 403 without fetching

  @AC-SEC-PROXY-06 @suite:hosts
  Scenario: The local server checks the addresses a name resolves to
    Given a host name that resolves to a special-purpose address
    When the local server's fetch connects to it
    Then the connection is refused unless the host is listed

  @AC-SEC-PROXY-07 @suite:hosts
  Scenario: The Worker is closed until targets are configured
    Given a Worker with neither MCP_TESTER_ALLOWED_TARGETS nor ALLOWED_ORIGINS set
    When /proxy is asked for any target
    Then it answers 403 with a hint to set MCP_TESTER_ALLOWED_TARGETS
    And "*" allows public targets but still not special-purpose ones

  @AC-SEC-PROXY-08 @suite:hosts
  Scenario: The local server will not listen beyond loopback without a token
    Given HOST is not a loopback address
    When MCP_TESTER_TOKEN is missing or shorter than 32 characters
    Then the server exits with an explanation instead of starting

  @AC-SEC-PROXY-09 @suite:hosts
  Scenario: With a token, every request needs it
    Given the local server has a token
    When a request arrives without it
    Then it is answered 401, except the client metadata document
    And the access link sets an HttpOnly, SameSite=Lax cookie holding an HMAC of the token, never the token
    And that cookie, or an Authorization Bearer header with the token, lets requests through

  @AC-SEC-PROXY-10 @suite:e2e
  Scenario: A refusal is shown as a failed call with the proxy's reason
    Given a target the proxy refuses
    When the UI connects to it
    Then the connection fails, the server is never contacted, no sign-in is offered
    And the Log shows the proxy's reason and the hint to set MCP_TESTER_ALLOWED_TARGETS
