var state = {
  sessionId: null, serverUrl: '', headers: {}, transport: 'streamable',
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

