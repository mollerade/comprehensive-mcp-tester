@issue:11
Feature: Compliance rules for capabilities, tools, resources, prompts and pagination
  As someone testing an MCP server,
  I want the tester to grade what the server lists, not only how it talks,
  so that broken tool schemas, unadvertised features and endless paging show up as findings.

  @AC-SPEC-TOOLS-01 @suite:compliance
  Scenario: Each feature rule is broken by its scenario
    Given one mock scenario per capability, tools, resources, prompts and pagination rule
    When each is graded
    Then exactly the rules that scenario breaks fail or warn

  @AC-SPEC-TOOLS-02 @suite:compliance
  Scenario: No rule without a breaking scenario
    Given the full catalogue
    When it is compared with the violation table
    Then every rule but the version check has a mock scenario that breaks it

  @AC-SPEC-TOOLS-03 @suite:compliance
  Scenario: Tool schemas are checked as JSON Schema 2020-12
    Given schemas with bad types, a non-list required, unresolvable and remote $refs, and an empty anyOf
    When the schema check runs
    Then each problem is reported with its JSON pointer, and sound schemas with local $refs and anchors pass

  @AC-SPEC-TOOLS-04 @suite:compliance
  Scenario: Event streams and the report
    Given an event-stream response and a failing recording
    When they are parsed and reported
    Then every data event is read, and the Markdown report links each finding to the spec and leaves out rules that do not apply
