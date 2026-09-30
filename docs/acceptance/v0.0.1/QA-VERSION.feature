@issue:7
Feature: Version bump and check that only allow +0.0.1 increments
  As a maintainer cutting a release,
  I want one command that sets the next version everywhere and a check that rejects anything else,
  so that versions only ever step by 0.0.1 and every place that shows the version agrees.

  @AC-QA-VERSION-01 @suite:tooling
  Scenario: Normal bump
    Given package.json version 0.0.1
    When npm run version:bump runs
    Then package.json and the root of package-lock.json both read 0.0.2

  @AC-QA-VERSION-02 @suite:tooling
  Scenario: Patch rollover
    Given version 0.0.999
    When the bump runs
    Then the new version is 0.1.0

  @AC-QA-VERSION-03 @suite:tooling
  Scenario: Minor rollover
    Given version 0.999.999
    When the bump runs
    Then the new version is 1.0.0

  @AC-QA-VERSION-04 @suite:tooling
  Scenario: Skipping a version is rejected
    Given base version 0.0.1 and a PR that sets 0.0.3
    When npm run version:check -- --base 0.0.1 runs
    Then it exits 1 with "version must be 0.0.2 (got 0.0.3)"

  @AC-QA-VERSION-05 @suite:tooling
  Scenario: Invalid versions are rejected
    Given candidate versions 0.0.1000, 0.0.x, 0.0.2-rc.1 and 0.0.0 against base 0.0.1
    When the check runs for each
    Then each exits 1 with a message naming the rule broken (range, numeric, no pre-release, must increase)

  @AC-QA-VERSION-06 @suite:tooling
  Scenario: Changelog heading added
    Given CHANGELOG.md has an "## [Unreleased]" section with two entries
    When the bump to 0.0.2 runs on 2026-10-01
    Then a heading "## [0.0.2] - 2026-10-01" holds those entries and an empty "## [Unreleased]" sits above it

  # The issue placed this test in tests/e2e/version.test.js; it lives in tests/e2e.test.mjs to share its browser.
  @AC-QA-VERSION-07 @suite:e2e
  Scenario: Built artefacts carry the version
    Given version 0.0.1
    When npm run build then the page is opened in the e2e browser
    Then the first line comment of dist/worker.js contains v0.0.1 and the About/footer text shows v0.0.1
