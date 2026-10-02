@issue:5
Feature: Scenario registry and test helper for the mock MCP server
  As a test author writing regression tests for a new AC,
  I want the bundled mock MCP server to expose named, deterministic misbehaviour scenarios and a start/stop helper,
  so that every acceptance criterion, including spec violations and failures, can be reproduced offline and in parallel.

  @AC-QA-MOCK-01 @suite:proxy
  Scenario: Scenarios are discoverable
    Given the mock server is running
    When a client sends GET /__scenarios
    Then the response is 200 JSON listing every scenario with name, description and protocol, including all ten existing paths

  @AC-QA-MOCK-02 @suite:proxy
  Scenario: Existing paths are unchanged
    Given the scenario registry is in place
    When the pre-existing suites run
    Then every pre-existing test passes without modification

  @AC-QA-MOCK-03 @suite:proxy
  Scenario: Parallel-safe helper
    Given two tests call startMock({ port: 0 }) concurrently
    When each sends initialize to its own /mcp
    Then they receive different ports and different Mcp-Session-Id values, and close() frees both ports

  @AC-QA-MOCK-04 @suite:proxy
  Scenario: Violation scenario is deterministic
    Given scenario wrong-jsonrpc-version
    When a client calls tools/list 20 times
    Then every response has "jsonrpc":"1.0" and an otherwise valid result

  @AC-QA-MOCK-05 @suite:proxy
  Scenario: Unknown scenario is a clear error
    Given the mock server is running
    When a client posts to /scenario/does-not-exist/mcp
    Then the response is 404 with body "unknown scenario: does-not-exist"

  @AC-QA-MOCK-06 @suite:proxy
  Scenario: Latency knob
    Given any scenario
    When a request is sent with query ?delay=300
    Then the response arrives no sooner than 300 ms after the request
