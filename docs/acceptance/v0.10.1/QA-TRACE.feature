@issue:4
Feature: AC traceability checker (npm run test:trace)
  As a maintainer reviewing a pull request,
  I want a single command that proves every acceptance criterion has a matching automated test
  and every AC-tagged test points at a real criterion,
  so that closing an issue means its behaviour is locked in by the regression suite.

  @AC-QA-TRACE-01 @suite:tooling
  Scenario: Covered AC passes
    Given docs/acceptance/v0.10.1/QA-TRACE.feature defines @AC-QA-TRACE-01 and a test titled "AC-QA-TRACE-01: ..." exists
    When npm run test:trace runs
    Then it exits 0 and lists AC-QA-TRACE-01 as covered with the test file path

  @AC-QA-TRACE-02 @suite:tooling
  Scenario: Missing test fails with a precise message
    Given a .feature file defines @AC-DEMO-02 and no test title contains it
    When the checker runs
    Then it exits 1 and stderr contains "missing: AC-DEMO-02 (docs/acceptance/.../DEMO.feature:<line>)"

  @AC-QA-TRACE-03 @suite:tooling
  Scenario: Unknown AC ID in a test fails
    Given a test is titled "AC-DEMO-99: typo" and no .feature file defines that ID
    When the checker runs
    Then it exits 1 and reports "unknown: AC-DEMO-99" with the test file and line

  @AC-QA-TRACE-04 @suite:tooling
  Scenario: Duplicate AC IDs are rejected
    Given two scenarios anywhere under docs/acceptance/ share the tag @AC-DEMO-01
    When the checker runs
    Then it exits 1 and reports "duplicate: AC-DEMO-01" with both locations

  @AC-QA-TRACE-05 @suite:tooling
  Scenario: Pending ACs only pass until their milestone
    Given package.json version is 0.10.1
    And a scenario tagged @pending lives under docs/acceptance/v0.10.2/
    When the checker runs
    Then the AC is reported as pending and the exit code is 0
    And when the same fixture is run with version 0.10.2 the exit code is 1 with "pending past milestone: <ID>"

  @AC-QA-TRACE-06 @suite:tooling
  Scenario: Machine-readable output
    Given a fixture tree with 3 covered, 1 missing and 2 pending ACs
    When the checker runs with --format=json
    Then stdout is valid JSON with {"covered":3,"missing":1,"pending":2,"unknown":0,"items":[...]}
    And each item has id, status, feature and tests[]

  @AC-QA-TRACE-07 @suite:tooling
  Scenario: Zero dependencies
    Given a checkout where node_modules is absent
    When node scripts/check-traceability.mjs runs
    Then it completes without ERR_MODULE_NOT_FOUND (only node: imports are used)
