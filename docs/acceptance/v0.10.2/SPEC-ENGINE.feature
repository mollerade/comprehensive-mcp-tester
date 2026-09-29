@issue:9
Feature: Compliance platform-free rule engine and rule catalogue format
  As a maintainer adding compliance rules,
  I want a deterministic engine that selects rules by the server's claimed protocol version and evaluates them over recorded exchanges,
  so that rules are small, independently testable data and the same results come out on the Worker, the Node server and in tests.

  @AC-SPEC-ENGINE-01 @suite:compliance
  Scenario: Catalogue is well-formed
    Given the full rule catalogue
    When a unit test loads it
    Then every rule has a unique ID matching ^MCP-[A-Z]+-\d{3}$, a severity, at least one appliesTo version and an https specRef

  @AC-SPEC-ENGINE-02 @suite:compliance
  Scenario: Rules selected by claimed version
    Given a server that claims 2026-07-28
    When the engine selects rules
    Then only rules whose appliesTo contains 2026-07-28 run and all others are listed as not-applicable

  @AC-SPEC-ENGINE-03 @suite:compliance
  Scenario: Unknown version is best effort
    Given a server that claims 2099-01-01
    When the check runs
    Then MCP-VER-001 is warn with text "unknown protocol version", and the newest known rule set runs with each result marked best effort

  @AC-SPEC-ENGINE-04 @suite:compliance
  Scenario: A crashing rule does not stop the run
    Given a test rule whose check throws "boom"
    When the engine evaluates the catalogue
    Then that rule's status is error with message "boom" and every other rule still has a result

  @AC-SPEC-ENGINE-05 @suite:compliance
  Scenario: Deterministic evaluation
    Given the same recorded exchanges
    When the engine evaluates them twice
    Then the two result arrays are deep-equal and no network call is attempted during evaluation

  @AC-SPEC-ENGINE-06 @suite:compliance
  Scenario: Warn-severity rules never produce fail
    Given a rule with severity warn whose check fails
    When results are aggregated
    Then that rule is warn and the verdict is warn when no other rule fails

  @AC-SPEC-ENGINE-07 @suite:hosts
  Scenario: Platform-free
    Given npm run build
    When the build scans src/core/compliance/
    Then it fails if any file imports node:* or a Cloudflare-only API, and passes on the shipped code
