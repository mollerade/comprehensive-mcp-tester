var state = {
  sessionId: null, serverUrl: '', headers: {}, transport: 'streamable',
  era: null, protocolVersion: null,
  connected: false, connecting: false, rpcId: 0,
  generation: 0,        // bumped on every connect/disconnect; stale responses are dropped
  tools: [], resources: [], prompts: [], log: [],
  activeTab: 'tools', expandedItem: null,
  servers: [], activeServerId: null, serverInfo: null,
  drafts: {}, filters: { tools: '', resources: '', prompts: '' }
};

var diag = {
  probes: [], maxProbes: 500,
  monitorTimer: null, intervalMs: 0,
  slowMs: 2000, probeMethod: 'auto',
  running: false, startedAt: null
};

/* Authentication. In memory only, by design: a reload forgets every credential.
   boundTo is the server the credentials were set up for; they are never sent elsewhere. */
var auth = {
  mode: 'none', boundTo: null,
  bearer: '', apiKeyName: 'X-API-Key', apiKeyValue: '',
  clientId: '', clientSecret: '', scope: '', tokenEndpoint: '',
  preIssuer: null,        // issuer a pre-registered client ID was first used with
  registrations: {},      // issuer → { client_id, client_secret, how }  (spec: key by issuer)
  token: null,            // { access_token, token_type, expires_at, refresh_token, scope, issuer, renew }
                          //   renew: how to get the next one (refresh_token or client_credentials grant), see auth-refresh.js
  challenge: null,        // last 401/403 { status, header, params, at }
  pending: null,          // in-flight authorization request (state, PKCE verifier, expected issuer)
  refreshing: null,       // the renewal in flight, shared by every request that needs it
  allowIssuerMismatch: false,   // testing switch: continue past an AS metadata issuer mismatch (RFC 8414 \u00a73.3), with a warning
  // Client credentials with non-standard field names (e.g. profileID / secret), for servers that need them
  ccStyle: 'standard', ccIdField: 'profileID', ccSecretField: 'secret', ccBodyFormat: 'form', ccStandardParams: true,
  trace: [], busy: false
};

var AUTH_MODES = [
  ['none', 'None'], ['oauth', 'OAuth sign-in'], ['bearer', 'Bearer token'],
  ['apikey', 'API key header'], ['client_credentials', 'Client credentials']
];
var REDACT_KEYS = ['access_token', 'refresh_token', 'id_token', 'client_secret', 'code_verifier',
                   'password', 'assertion', 'client_assertion', 'registration_access_token'];

var STRIP_MAX = 120;
var LOG_MAX = 1000;       // newest request log entries kept; a monitor left running must not grow it without bound

/* Protocol eras (spec 2026-07-28, "Versioning and Compatibility"):
   modern = stateless, version + identity in every request's _meta, mirrored into headers;
   legacy = initialize handshake, optional Mcp-Session-Id (2025-11-25 and earlier). */
var MODERN_VERSIONS = ['2026-07-28'];
var LEGACY_VERSION = '2025-11-25';
var MODERN_ERROR_CODES = [-32020, -32021, -32022];   // HeaderMismatch, MissingRequiredClientCapability, UnsupportedProtocolVersion
var MCP_META = 'io.modelcontextprotocol/';
var CLIENT_INFO = { name: 'MCP Tester', version: '0.0.1' };

