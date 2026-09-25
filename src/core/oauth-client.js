/**
 * The tester's OAuth client identity — platform-free, shared by every host.
 *
 * Hosts serve the Client ID Metadata Document (draft-ietf-oauth-client-id-metadata-document)
 * at CLIENT_METADATA_PATH and the UI page at CALLBACK_PATH. An authorization server
 * can only fetch the document from a public HTTPS origin, so the UI uses CIMD on the
 * Worker and falls back to dynamic registration or a pre-registered client locally.
 */

export var CLIENT_METADATA_PATH = '/oauth/client-metadata.json';
export var CALLBACK_PATH = '/oauth/callback';

/** @param {string} origin  e.g. "https://mcp-tester.example.workers.dev" (no trailing slash) */
export function clientMetadataDocument(origin) {
  return {
    client_id: origin + CLIENT_METADATA_PATH,
    client_name: 'MCP Tester',
    client_uri: origin,
    redirect_uris: [origin + CALLBACK_PATH],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}
