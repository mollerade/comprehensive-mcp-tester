@issue:39
Feature: Guard connections with a generation token (stale responses)
  As a person switching between servers in one session,
  I want responses from a previous connection to never populate the current one,
  so that the tool list, diagnostics and identity I see always belong to the server I am connected to now.

  @AC-BUG-CONNGEN-01 @suite:e2e
  Scenario: A stale response is ignored
    Given a connection to server A with a slow tools/list in flight
    When the user connects to server B before A responds
    Then A's late response does not change state.tools, identity or diagnostics

  @AC-BUG-CONNGEN-02 @suite:e2e
  Scenario: Disconnect invalidates in-flight work
    Given an in-flight list request
    When the user disconnects
    Then the response is dropped and no view updates
