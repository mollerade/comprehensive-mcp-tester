@issue:12
Feature: Compliance rules for authorization, built on the discovery a client follows
  As someone testing an MCP server that needs a sign-in,
  I want the check to follow the server's authorization discovery and grade each step,
  so that a broken challenge, missing metadata or a mismatched issuer shows up before any client tries to sign in.

  @AC-SPEC-AUTH-01 @suite:compliance
  Scenario: A correctly protected server passes
    Given the mock's /secure server and its authorization server
    When it is checked without a token
    Then every authorization rule passes, the report says only authorization was graded, and the check exits 0

  @AC-SPEC-AUTH-02 @suite:compliance
  Scenario: Each authorization rule is broken by its scenario
    Given one mock scenario per rule: no challenge, no resource_metadata, no protected resource metadata, a different resource, an issuer mismatch, no PKCE S256, an http endpoint, no registration, no iss support
    When each is graded
    Then exactly the rules that scenario breaks fail or warn, and the issuer finding names both issuers

  @AC-SPEC-AUTH-03 @suite:compliance
  Scenario: Discovery runs only when the server asks
    Given an open server, and a protected one checked with a valid token
    When the check runs
    Then the open server is not asked about authorization, and for the protected one a single handshake without the token finds the challenge that discovery follows

  @AC-SPEC-AUTH-04 @suite:compliance
  Scenario: Discovery follows the spec order and sends no credentials
    Given a challenge with a resource_metadata URL and a server under a path
    When discovery runs
    Then it tries the hinted URL, then the path-inserted and root well-known URLs, with GET and without the caller's headers
