Feature: Client credentials under the server's own field names
  As someone testing a server whose token endpoint wants, say, profileID and secret,
  I want to name the credential fields and choose the body format,
  so that I can get a token without a custom script.

  @AC-AUTH-CUSTOM-CC-01 @suite:e2e
  Scenario: Custom field names, as JSON
    Given client credentials mode with custom field names profileID and secret and a JSON body
    When a token is requested from the discovered token endpoint
    Then the body carries profileID and secret, plus grant_type, scope and resource, and no Basic auth
    And the secret is redacted from the Log, and renewal sends the same request

  @AC-AUTH-CUSTOM-CC-02 @suite:e2e
  Scenario: Only the two custom fields, as a form
    Given custom field names with the standard parameters turned off
    When a token is requested
    Then the form body carries only the two fields
