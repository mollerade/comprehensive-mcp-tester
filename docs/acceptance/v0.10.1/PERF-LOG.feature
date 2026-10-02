@issue:40
Feature: Cap the request Log so long monitor sessions stay bounded
  As a person leaving the health monitor running,
  I want the request Log to keep a bounded number of entries,
  so that memory and re-render cost stay flat however long it runs.

  @AC-PERF-LOG-01 @suite:ui-logic
  Scenario: The log is bounded
    Given the cap is N
    When more than N entries are added
    Then state.log.length never exceeds N and the newest entry is kept
