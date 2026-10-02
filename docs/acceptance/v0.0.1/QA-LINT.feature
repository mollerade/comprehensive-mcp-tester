@issue:43
Feature: Add ESLint and a CI lint and complexity gate
  As a contributor,
  I want a linter enforced in CI with the complexity ceilings,
  so that common mistakes are caught automatically and code does not grow more complex.

  @AC-QA-LINT-01 @suite:tooling
  Scenario: Lint runs in CI at zero warnings
    Given the CI workflow
    When a test reads the workflow text
    Then it runs npm run lint and fails on any warning

  @AC-QA-LINT-02 @suite:tooling
  Scenario: Client JS stays ES5-style and module-free
    Given the ESLint config for src/ui/js
    When a file uses import/export or let/const there
    Then lint fails, matching the repo's classic-script rule
