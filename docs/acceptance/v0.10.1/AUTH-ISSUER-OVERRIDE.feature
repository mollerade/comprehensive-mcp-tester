Feature: Test past an authorization server issuer mismatch, on purpose
  As someone testing a server whose authorization server metadata has the wrong issuer,
  I want a switch, off by default, to continue past that check with a warning,
  so that I can test the rest of the flow while the server is being fixed.

  @AC-AUTH-ISSUER-OVERRIDE-01 @suite:e2e
  Scenario: An issuer mismatch stops discovery by default
    Given authorization server metadata whose issuer differs from the one the resource names
    When sign-in starts with the switch off
    Then discovery fails citing RFC 8414, names the switch, and no authorization request is made

  @AC-AUTH-ISSUER-OVERRIDE-02 @suite:e2e
  Scenario: With the switch on, discovery continues with a warning
    Given the switch is on
    When sign-in runs
    Then the dialog and the trace warn that a compliant client must stop
    And the authorization response's iss is still checked, and the connection succeeds
