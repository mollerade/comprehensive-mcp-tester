@issue:46
Feature: Governance and supply-chain files for L2 compliance
  As a maintainer aiming for the L2 public standard,
  I want the governance and supply-chain files in place,
  so that the repo is safe for corporate users to adopt.

  @AC-GOV-COMPLIANCE-01 @suite:tooling
  Scenario: Governance files present
    Given the repo root
    When it is audited
    Then SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, and .github templates exist

  @AC-GOV-COMPLIANCE-02 @suite:tooling
  Scenario: License is declared once chosen
    Given the owner has chosen a license
    When the repo is audited
    Then a LICENSE file and a matching package.json license (SPDX) are present
