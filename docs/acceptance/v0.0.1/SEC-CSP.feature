@issue:41
Feature: Send a Content-Security-Policy from both hosts
  As a person using MCP Tester with real credentials,
  I want the page served with a Content-Security-Policy,
  so that an injected script cannot send in-memory tokens to another origin or frame the tester.

  @AC-SEC-CSP-01 @suite:hosts
  Scenario: Both hosts send the policy
    Given a GET for the UI from the Node host and the Cloudflare host
    When the response headers are read
    Then both carry the CSP with connect-src 'self' and frame-ancestors 'none'

  @AC-SEC-CSP-02 @suite:e2e
  Scenario: The app still functions under the policy
    Given the CSP is active
    When the e2e suite runs (connect, sign in, execute, diagnostics)
    Then every existing e2e assertion still passes
