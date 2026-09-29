@issue:42
Feature: Keep the client secret out of sessionStorage on redirect
  As a person signing in with a confidential client while pop-ups are blocked,
  I want the client secret never written to sessionStorage,
  so that it stays in memory like every other credential.

  @AC-SEC-SESSION-01 @suite:ui-logic
  Scenario: No secret in sessionStorage
    Given a client secret was entered and the redirect fallback runs
    When the pending blob is written
    Then it contains no client_secret field
