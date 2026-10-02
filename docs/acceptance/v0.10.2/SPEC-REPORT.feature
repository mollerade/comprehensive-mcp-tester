@issue:13
Feature: The compliance report in the app, with evidence, cancel and export
  As someone testing an MCP server from a browser or an iPad,
  I want to run the compliance check from the tester and read, share and export the report,
  so that I do not need the command line to grade a server.

  @AC-SPEC-REPORT-01 @suite:compliance
  Scenario: The host runs the check
    Given POST /compliance with a server URL, on the local server and on the Worker
    When the server is graded
    Then the answer has the summary, the report with each finding's evidence, and its Markdown, but not the raw exchanges
    And the Worker refuses until targets are configured

  @AC-SPEC-REPORT-02 @suite:compliance
  Scenario: The endpoint is guarded like /proxy
    Given a foreign Origin, an unlisted loopback target, a missing url, or a non-JSON body
    When /compliance is called
    Then it answers 403, 403 with a hint, 400 and 415, and sends no probe

  @AC-SPEC-REPORT-03 @suite:compliance
  Scenario: A cancelled check stops sending probes
    Given a check in flight against a slow server
    When the caller aborts the request
    Then at most the probe in flight completes, and no more are sent

  @AC-SPEC-REPORT-04 @suite:e2e
  Scenario: The Compliance tab shows the verdict and findings
    Given the Compliance tab
    When a check runs against a correct server and a broken one
    Then the verdict, a badge, and each finding with its spec link and expandable evidence are shown, failures first, at phone width without overflow

  @AC-SPEC-REPORT-05 @suite:e2e
  Scenario: The report exports
    Given a finished report
    When Copy Markdown and Download JSON are used
    Then the Markdown report is copied and a JSON file with the target and the report is downloaded

  @AC-SPEC-REPORT-06 @suite:e2e
  Scenario: Credentials go only to the server they are bound to
    Given a protected server, checked first without and then with a sign-in, and then another server
    When the checks run
    Then the first grades authorization only and says so, the second grades the protocol too, the token never reaches the page, and the other server gets no token

  @AC-SPEC-REPORT-07 @suite:e2e
  Scenario: Cancel
    Given a check in flight
    When Cancel is pressed
    Then the check stops and says it was cancelled, and Run is offered again
