@issue:80
Feature: Release 0.0.1: bump, tag and audit the first release
  As a maintainer,
  I want to publish 0.0.1 through the signed-tag pipeline and read it back,
  so that the first release is verifiable and every later one follows the same path.

  @AC-REL-V001-01 @suite:tooling
  Scenario: Versions agree
    Given the release branch after the bump
    When npm run version:check runs
    Then every version reference says 0.0.1

  # The audit itself is the last step of .github/workflows/release.yml; the test checks that step is wired.
  @AC-REL-V001-02 @suite:tooling
  Scenario: Published release reads back
    Given the v0.0.1 tag is pushed
    When the post-publish audit runs
    Then tag signature, message, assets, SHA256SUMS and attestations all verify
