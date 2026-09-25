var state = {
  sessionId: null, serverUrl: '', headers: {}, transport: 'streamable',
  era: null, protocolVersion: null,
  connected: false, connecting: false, rpcId: 0,
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

var STRIP_MAX = 120;

/* Protocol eras (spec 2026-07-28, "Versioning and Compatibility"):
   modern = stateless, version + identity in every request's _meta, mirrored into headers;
   legacy = initialize handshake, optional Mcp-Session-Id (2025-11-25 and earlier). */
var MODERN_VERSIONS = ['2026-07-28'];
var LEGACY_VERSION = '2025-11-25';
var MODERN_ERROR_CODES = [-32020, -32021, -32022];   // HeaderMismatch, MissingRequiredClientCapability, UnsupportedProtocolVersion
var MCP_META = 'io.modelcontextprotocol/';
var CLIENT_INFO = { name: 'MCP Tester', version: '0.9.0' };

