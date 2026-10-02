@issue:6
Feature: Make e2e mandatory in CI, publish JUnit reports, surface failing AC IDs
  As a maintainer reviewing a pull request,
  I want CI to fail when the browser tests cannot run, and to show which acceptance criteria failed,
  so that a broken Playwright install cannot turn UI regressions into skips.

  @AC-QA-CI-01 @suite:tooling
  Scenario: E2E cannot silently skip in CI
    Given CI=true
    And the Chromium executable path points to a missing file
    When the e2e suite starts
    Then it exits non-zero with "Chromium is required when CI=true"

  @AC-QA-CI-02 @suite:tooling
  Scenario: Local skip behaviour preserved
    Given CI is unset
    And Chromium is not installed
    When the e2e suite starts
    Then it is skipped with the existing notice and npm test exits 0

  @AC-QA-CI-03 @suite:tooling
  Scenario: JUnit report per Node version
    Given npm run test:ci runs on Node 22
    When it finishes
    Then reports/junit-node22.xml exists, is well-formed XML and has one <testcase> per executed test

  @AC-QA-CI-04 @suite:tooling
  Scenario: Failing AC IDs in the job summary
    Given a fixture JUnit file with failures "AC-X-01: a" and "AC-Y-03: b" plus one untagged failure
    When node scripts/ci-summary.mjs <file> runs with GITHUB_STEP_SUMMARY set to a temp file
    Then the file contains a markdown table listing AC-X-01, AC-Y-03 and (untagged) with their test names

  # The issue named Node 20 and 22; the supported versions became 22 and 24 when Node 20 reached end of life (#58).
  @AC-QA-CI-05 @suite:tooling
  Scenario: Workflow wires every gate
    Given .github/workflows/*.yml
    When a test reads the workflow text
    Then it runs on Node 22 and 24, runs test:ci and test:trace, uploads reports/, and every job sets timeout-minutes of 15 or less
