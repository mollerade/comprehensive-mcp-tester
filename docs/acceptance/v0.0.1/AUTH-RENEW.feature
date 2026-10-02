Feature: Keep an access token fresh
  As someone testing an MCP server for longer than a token lives,
  I want the tester to renew the token itself,
  so that a session does not fail with 401 every hour.

  @AC-AUTH-RENEW-01 @suite:e2e
  Scenario: A token about to expire is refreshed before the request
    Given an OAuth sign-in that returned a refresh token
    When the access token expires within a minute and a request is sent
    Then a refresh_token grant with the resource indicator is sent first
    And the request carries the new access token

  @AC-AUTH-RENEW-02 @suite:e2e
  Scenario: A 401 to the current token renews it once and resends
    Given the server stops accepting the access token
    When a request is answered 401
    Then the token is renewed once and the request is sent again
    And the Log shows the resend, with no token in the page

  @AC-AUTH-RENEW-03 @suite:e2e
  Scenario: A renewal that fails is not retried on every call
    Given the refresh token is no longer valid
    When a request is answered 401 and the renewal fails
    Then the 401 is shown as it is, the trace records the failure, and later calls do not try again

  @AC-AUTH-RENEW-04 @suite:e2e
  Scenario: A client credentials token is renewed with the client credentials
    Given a token from the client credentials grant
    When the server answers 401
    Then a new client credentials grant is sent, as the first one was, and the request is resent
