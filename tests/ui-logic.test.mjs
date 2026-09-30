/**
 * Pure logic inside the client JS, run in a VM with a minimal DOM stub.
 * Loads the exact script the page ships (assembleJs), so this tests real code.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { assembleJs } from '../src/ui/assemble.js';

function loadClient() {
  const el = () => ({
    value: '', textContent: '', innerHTML: '', hidden: false, style: {}, title: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {}, click() {},
    getBoundingClientRect: () => ({ width: 100, height: 50 }),
  });
  const ctx = {
    document: { getElementById: el, querySelectorAll: () => [], createElement: el, body: el(), documentElement: el() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { innerWidth: 1200, innerHeight: 800, addEventListener() {} },
    location: { pathname: '/', search: '', origin: 'http://127.0.0.1:8787', protocol: 'http:', hostname: '127.0.0.1' },
    navigator: {},
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, alert() {}, console,
    Blob: function () {},
    fetch: () => new Promise(() => {}),
    btoa: globalThis.btoa, URL,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(assembleJs(), ctx, { filename: 'client.js' });
  return ctx;
}

let c;
beforeEach(() => { c = loadClient(); });

describe('percentile', () => {
  const s10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s100 = Array.from({ length: 100 }, (_, i) => i + 1);
  test('p50 of 1..10 = 5', () => assert.equal(c.percentile(s10, 0.5), 5));
  test('p95 of 1..10 = 10', () => assert.equal(c.percentile(s10, 0.95), 10));
  test('p100 = max', () => assert.equal(c.percentile(s10, 1), 10));
  test('single element', () => assert.equal(c.percentile([42], 0.95), 42));
  test('empty → null', () => assert.equal(c.percentile([], 0.5), null));
  test('p95 of 1..100 = 95', () => assert.equal(c.percentile(s100, 0.95), 95));
  test('p99 of 1..100 = 99', () => assert.equal(c.percentile(s100, 0.99), 99));
});

describe('probe classification', () => {
  beforeEach(() => { c.diag.slowMs = 2000; });
  test('fast success → ok', () => assert.equal(c.probeClass({ ok: true, ms: 100 }), 'ok'));
  test('slow success → slow', () => assert.equal(c.probeClass({ ok: true, ms: 5000 }), 'slow'));
  test('boundary (== slowMs) → ok', () => assert.equal(c.probeClass({ ok: true, ms: 2000 }), 'ok'));
  test('failure → fail', () => assert.equal(c.probeClass({ ok: false, ms: null }), 'fail'));
  test('failure outranks slow', () => assert.equal(c.probeClass({ ok: false, ms: 9000 }), 'fail'));
});

describe('computeStats on a flapping window', () => {
  let st;
  beforeEach(() => {
    c.diag.slowMs = 2000;
    c.diag.probes = [
      { t: 1, ok: true, ms: 100 }, { t: 2, ok: true, ms: 200 }, { t: 3, ok: false, ms: null, errorType: 'timeout' },
      { t: 4, ok: true, ms: 300 }, { t: 5, ok: true, ms: 5000 }, { t: 6, ok: true, ms: 150 },
      { t: 7, ok: true, ms: 250 }, { t: 8, ok: true, ms: 180 },
      { t: 9, ok: false, ms: null, errorType: 'timeout' }, { t: 10, ok: false, ms: null, errorType: 'http5xx' },
    ];
    st = c.computeStats();
  });
  test('total = 10', () => assert.equal(st.total, 10));
  test('ok = 7', () => assert.equal(st.ok, 7));
  test('fail = 3', () => assert.equal(st.fail, 3));
  test('slow = 1', () => assert.equal(st.slow, 1));
  test('uptime = 70%', () => assert.ok(Math.abs(st.uptime - 70) < 1e-9));
  test('ok + fail = total (no double count)', () => assert.equal(st.ok + st.fail, st.total));
  test('slow counted inside ok', () => assert.ok(st.slow <= st.ok));
  test('current streak = 2 (trailing failures)', () => assert.equal(st.curStreak, 2));
  test('max streak = 2', () => assert.equal(st.maxStreak, 2));
  test('errCounts timeout=2, http5xx=1', () => assert.deepEqual({ ...st.errCounts }, { timeout: 2, http5xx: 1 }));
  test('min = 100', () => assert.equal(st.min, 100));
  test('max = 5000', () => assert.equal(st.max, 5000));
  test('failures excluded from latency stats', () => assert.ok(st.p50 !== null && st.p50 < 5000));
});

describe('computeStats edge cases', () => {
  test('empty window → total 0, uptime null', () => {
    c.diag.probes = [];
    const s = c.computeStats();
    assert.equal(s.total, 0); assert.equal(s.uptime, null);
  });
  test('all-failed → uptime 0, no NaN, streak 1', () => {
    c.diag.probes = [{ t: 1, ok: false, ms: null, errorType: 'timeout' }];
    const s = c.computeStats();
    assert.equal(s.uptime, 0); assert.equal(s.p50, null); assert.equal(s.curStreak, 1); assert.equal(s.maxStreak, 1);
  });
  test('all-ok → uptime 100, streak 0', () => {
    c.diag.probes = [{ t: 1, ok: true, ms: 50 }];
    const s = c.computeStats();
    assert.equal(s.uptime, 100); assert.equal(s.curStreak, 0);
  });
});

describe('OAuth callback query', () => {
  test('only the authorization response parameters are kept', () => {
    const q = c.parseQuery('?__proto__=x&constructor=y&toString=z&extra=1&state=s&code=c&iss=i&error=e&error_description=d&error_uri=u');
    assert.deepEqual(Object.keys(q), ['state', 'code', 'iss', 'error', 'error_description', 'error_uri']);
    assert.equal(Object.getPrototypeOf(q), Object.getPrototypeOf(c.parseQuery('')), 'the prototype is untouched');
    assert.equal(typeof q.toString, 'function');
  });
});

describe('diagnostics report', () => {
  test('a Markdown table cell escapes backslashes before pipes', () => {
    assert.equal(c.mdCell('a|b'), 'a\\|b');
    assert.equal(c.mdCell('ends with \\|'), 'ends with \\\\\\|', 'a trailing backslash cannot unescape the pipe');
    assert.equal(c.mdCell(404), '404');
  });
});

describe('fmtMs', () => {
  test('null → em dash', () => assert.equal(c.fmtMs(null), '—'));
  test('850 → 850ms', () => assert.equal(c.fmtMs(850), '850ms'));
  test('1500 → 1.50s', () => assert.equal(c.fmtMs(1500), '1.50s'));
  test('45000 → 45.0s', () => assert.equal(c.fmtMs(45000), '45.0s'));
});

describe('suggested requests from a JSON schema', () => {
  const schema = {
    type: 'object', required: ['api_id', 'mode', 'verbose', 'tags'],
    properties: {
      api_id: { type: 'string' },
      mode: { type: 'string', enum: ['summary', 'full'] },
      verbose: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer', default: 10 },
      note: { type: 'string' },
      when: { type: 'string', format: 'date' },
    },
  };
  test('required params are always suggested', () => {
    const a = c.suggestArgs(schema);
    for (const k of ['api_id', 'mode', 'verbose', 'tags']) assert.ok(k in a, k);
  });
  test('enum → first value, boolean → false, array → one sample item', () => {
    const a = c.suggestArgs(schema);
    assert.equal(a.mode, 'summary'); assert.equal(a.verbose, false); assert.deepEqual([...a.tags], ['text']);
  });
  test('optional with a default is suggested; optional without a hint is not', () => {
    const a = c.suggestArgs(schema);
    assert.equal(a.limit, 10);
    assert.ok(!('note' in a));
    assert.ok(!('when' in a));
  });
  test('formats produce plausible values', () => {
    assert.match(c.suggestValue({ type: 'string', format: 'date' }), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(c.suggestValue({ type: 'string', format: 'email' }), 'user@example.com');
    assert.equal(c.suggestValue({ type: 'integer', minimum: 5 }), 5);
  });
  test('nested objects recurse, and recursion is bounded', () => {
    const v = c.suggestValue({ type: 'object', required: ['a'], properties: { a: { type: 'object', required: ['b'], properties: { b: { type: 'string' } } } } });
    assert.equal(v.a.b, 'text');
    const loop = { type: 'object', properties: {} }; loop.properties.self = loop;
    assert.doesNotThrow(() => c.suggestValue(loop));
  });
});

describe('JSON-RPC envelope', () => {
  test('requests get an incrementing numeric id', () => {
    const a = c.buildBody('tools/list', {}), b = c.buildBody('tools/list', {});
    assert.equal(typeof a.id, 'number'); assert.equal(b.id, a.id + 1);
  });
  test('notifications carry no id', () => {
    assert.ok(!('id' in c.buildBody('notifications/initialized', {})));
  });
});

describe('protocol eras (spec 2026-07-28)', () => {
  const V = 'io.modelcontextprotocol/protocolVersion';

  test('header values: plain ASCII passes through', () => assert.equal(c.encodeHeaderValue('us-west1'), 'us-west1'));
  test('header values: spec examples use the base64 sentinel', () => {
    assert.equal(c.encodeHeaderValue('Hello, 世界'), '=?base64?SGVsbG8sIOS4lueVjA==?=');
    assert.equal(c.encodeHeaderValue(' padded '), '=?base64?IHBhZGRlZCA=?=');
    assert.equal(c.encodeHeaderValue('line1\nline2'), '=?base64?bGluZTEKbGluZTI=?=');
    assert.equal(c.encodeHeaderValue('=?base64?literal?='), '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
  });

  test('legacy era: no _meta, no modern headers', () => {
    c.state.era = 'legacy';
    const b = c.buildBody('tools/list', {});
    c.applyModernMeta(b);
    assert.ok(!('_meta' in b.params));
  });

  test('modern era: _meta carries version, identity, capabilities', () => {
    c.state.era = 'modern'; c.state.protocolVersion = '2026-07-28';
    const b = c.buildBody('tools/list', {});
    c.applyModernMeta(b);
    assert.equal(b.params._meta[V], '2026-07-28');
    assert.equal(b.params._meta['io.modelcontextprotocol/clientInfo'].name, 'MCP Tester');
    assert.deepEqual({ ...b.params._meta['io.modelcontextprotocol/clientCapabilities'] }, {});
  });

  test('modern era: an explicit _meta version in edited JSON is kept', () => {
    c.state.era = 'modern'; c.state.protocolVersion = '2026-07-28';
    const b = { jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: { [V]: '1900-01-01' } } };
    c.applyModernMeta(b);
    assert.equal(b.params._meta[V], '1900-01-01');
    assert.equal(c.modernHeaders(b)['MCP-Protocol-Version'], '1900-01-01');
  });

  test('server/discover is modern even before an era is known', () => {
    c.state.era = null;
    const b = c.buildBody('server/discover', {});
    c.applyModernMeta(b);
    assert.equal(b.params._meta[V], '2026-07-28');
  });

  test('headers mirror method, name/uri and x-mcp-header arguments', () => {
    c.state.era = 'modern'; c.state.protocolVersion = '2026-07-28';
    c.state.tools = [{ name: 'q', inputSchema: { type: 'object', properties: {
      region: { type: 'string', 'x-mcp-header': 'Region' },
      opts: { type: 'object', properties: { dry: { type: 'boolean', 'x-mcp-header': 'Dry' } } },
      ratio: { type: 'number', 'x-mcp-header': 'Ratio' },
      bad: { type: 'string', 'x-mcp-header': 'has space' },
    } } }];
    const b = c.buildBody('tools/call', { name: 'q', arguments: { region: 'eu', opts: { dry: false }, ratio: 0.5, bad: 'x' } });
    c.applyModernMeta(b);
    const h = c.modernHeaders(b);
    assert.equal(h['MCP-Protocol-Version'], '2026-07-28');
    assert.equal(h['Mcp-Method'], 'tools/call');
    assert.equal(h['Mcp-Name'], 'q');
    assert.equal(h['Mcp-Param-Region'], 'eu');
    assert.equal(h['Mcp-Param-Dry'], 'false');
    assert.ok(!('Mcp-Param-Ratio' in h), 'non-integer numbers are not mirrored');
    assert.ok(!('Mcp-Param-has space' in h), 'invalid header names are skipped');
    assert.equal(c.modernHeaders(c.buildBody('resources/read', { uri: 'docs://x' }))['Mcp-Name'], 'docs://x');
    assert.ok(!('Mcp-Name' in c.modernHeaders(c.buildBody('tools/list', {}))));
  });

  test('only protocol-reserved error codes count as modern', () => {
    assert.equal(c.isModernError({ error: { code: -32022 } }), true);
    assert.equal(c.isModernError({ error: { code: -32020 } }), true);
    assert.equal(c.isModernError({ error: { code: -32000, message: 'No valid session ID' } }), false);
    assert.equal(c.isModernError({ raw: '' }), false);
  });

  test('version picking from an UnsupportedProtocolVersion list', () => {
    assert.equal(c.pickVersion(['2027-01-01', '2026-07-28'], c.MODERN_VERSIONS), '2026-07-28');
    assert.equal(c.pickVersion(['2027-01-01'], c.MODERN_VERSIONS), null);
    assert.equal(c.pickVersion(['2026-07-28', '2025-06-18'], null), '2025-06-18');
  });
});

describe('authorization helpers', () => {
  test('WWW-Authenticate: Bearer parameters, quoted and bare, case-insensitive names', () => {
    const c1 = c.parseWwwAuthenticate('Bearer resource_metadata="https://m.example/.well-known/oauth-protected-resource/mcp", scope="files:read files:write", error=invalid_token');
    assert.equal(c1.scheme, 'Bearer');
    assert.equal(c1.params.resource_metadata, 'https://m.example/.well-known/oauth-protected-resource/mcp');
    assert.equal(c1.params.scope, 'files:read files:write');
    assert.equal(c1.params.error, 'invalid_token');
    assert.equal(c.parseWwwAuthenticate('Basic realm="x", Bearer Scope="a"').params.scope, 'a');
    assert.equal(c.parseWwwAuthenticate('Bearer error_description="say \\"hi\\""').params.error_description, 'say "hi"');
    assert.equal(c.parseWwwAuthenticate(null), null);
  });

  test('protected resource metadata URLs: path-inserted first, then root', () => {
    assert.deepEqual([...c.wellKnownPrmUrls('https://example.com/public/mcp')],
      ['https://example.com/.well-known/oauth-protected-resource/public/mcp', 'https://example.com/.well-known/oauth-protected-resource']);
    assert.deepEqual([...c.wellKnownPrmUrls('https://example.com/')], ['https://example.com/.well-known/oauth-protected-resource']);
  });

  test('authorization server metadata URLs follow the spec priority', () => {
    assert.deepEqual([...c.asMetadataUrls('https://auth.example.com/tenant1')], [
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1',
      'https://auth.example.com/.well-known/openid-configuration/tenant1',
      'https://auth.example.com/tenant1/.well-known/openid-configuration',
    ]);
    assert.deepEqual([...c.asMetadataUrls('https://auth.example.com')], [
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ]);
  });

  test('canonical resource URI: lowercase host, no fragment, no bare trailing slash', () => {
    assert.equal(c.canonicalResource('HTTPS://MCP.Example.com/'), 'https://mcp.example.com');
    assert.equal(c.canonicalResource('https://mcp.example.com/mcp#x'), 'https://mcp.example.com/mcp');
    assert.equal(c.canonicalResource('https://mcp.example.com:8443'), 'https://mcp.example.com:8443');
  });

  test('iss validation follows the RFC 9207 table', () => {
    const I = 'https://as.example';
    assert.equal(c.checkIss(I, I, true), null);
    assert.match(c.checkIss(undefined, I, true), /no iss/);
    assert.equal(c.checkIss(undefined, I, false), null);
    assert.match(c.checkIss('https://evil.example', I, false), /does not match/);
    assert.match(c.checkIss('https://as.example/', I, true), /does not match/, 'no trailing-slash normalisation');
  });

  test('redaction hides secrets and tokens but keeps metadata fields', () => {
    const r = c.redact({ access_token: 'abc', token_type: 'Bearer', token_endpoint: 'https://t', nested: { client_secret: 'shh' } });
    assert.equal(r.access_token, '[redacted, 3 chars]');
    assert.equal(r.token_type, 'Bearer');
    assert.equal(r.token_endpoint, 'https://t');
    assert.equal(r.nested.client_secret, '[redacted, 3 chars]');
  });

  test('authorization endpoint must be https, or http only on loopback', () => {
    assert.equal(c.isNavigableAuthUrl('https://as.example/authorize'), true);
    assert.equal(c.isNavigableAuthUrl('http://127.0.0.1:9000/authorize'), true, 'loopback http is allowed for local testing');
    assert.equal(c.isNavigableAuthUrl('http://localhost/authorize'), true);
    assert.equal(c.isNavigableAuthUrl('http://as.example/authorize'), false, 'plain http to a remote host is refused');
    assert.equal(c.isNavigableAuthUrl('javascript:window.opener.x=1'), false, 'a javascript: URL never navigates');
    assert.equal(c.isNavigableAuthUrl('data:text/html,<script>1</script>'), false);
    assert.equal(c.isNavigableAuthUrl('not a url'), false);
    assert.equal(c.isNavigableAuthUrl(''), false);
  });

  test('form encoding round-trips and skips empty values', () => {
    const enc = c.formEncode({ a: 'x y', b: 'https://h/p?q=1', skip: '', none: null });
    assert.equal(enc, 'a=x%20y&b=https%3A%2F%2Fh%2Fp%3Fq%3D1');
    assert.deepEqual({ ...c.parseQuery('?code=x+y&iss=https%3A%2F%2Fh&&state=') }, { code: 'x y', iss: 'https://h', state: '' });
  });

  test('credentials are only sent to the server they were set up for', () => {
    c.auth.mode = 'bearer'; c.auth.bearer = 'T'; c.auth.boundTo = 'https://a.example/mcp';
    c.state.serverUrl = 'https://a.example/mcp';
    assert.equal(c.authHeaders().Authorization, 'Bearer T');
    c.state.serverUrl = 'https://b.example/mcp';
    assert.deepEqual({ ...c.authHeaders() }, {});
    c.auth.mode = 'apikey'; c.auth.apiKeyName = 'X-Key'; c.auth.apiKeyValue = 'K'; c.state.serverUrl = 'https://a.example/mcp';
    assert.deepEqual({ ...c.authHeaders() }, { 'X-Key': 'K' });
  });
});

describe('untrusted server data never breaks out of an id attribute (XSS)', () => {
  // A malicious/compromised MCP server controls tool schema property names and
  // prompt argument names. They render into id="..." attributes, so a raw name
  // containing a quote would otherwise break out into markup.
  const PAYLOAD = 'x"><img src=x onerror="alert(1)">';

  test('tool schema property name is escaped in the field id', () => {
    const tool = { name: 'evil', inputSchema: { type: 'object', properties: { [PAYLOAD]: { type: 'string' } } } };
    const html = c.renderToolDetail(tool, 0);
    assert.ok(!html.includes('"><img'), 'the quote must not close the id attribute');
    assert.ok(!html.includes('<img'), 'no <img element may appear');
    assert.ok(!html.includes('onerror="'), 'no live event handler (its quote is escaped away)');
    assert.ok(html.includes('id="param-0-x&quot;&gt;&lt;img'), 'the name is present, fully escaped');
  });

  test('prompt argument name is escaped in the field id', () => {
    const prompt = { name: 'evil', arguments: [{ name: PAYLOAD }] };
    const html = c.renderPromptDetail(prompt, 0);
    assert.ok(!html.includes('"><img'), 'the quote must not close the id attribute');
    assert.ok(!html.includes('<img'), 'no <img element may appear');
    assert.ok(html.includes('id="prompt-0-x&quot;&gt;&lt;img'), 'the name is present, fully escaped');
  });

  test('an ordinary name still yields the plain id the readers look up', () => {
    const tool = { name: 'ok', inputSchema: { type: 'object', properties: { category: { type: 'string' } } } };
    const html = c.renderToolDetail(tool, 0);
    // esc() is a no-op for a safe name, so getElementById('param-0-category') keeps matching.
    assert.ok(html.includes('id="param-0-category"'));
    const prompt = c.renderPromptDetail({ name: 'ok', arguments: [{ name: 'api_id' }] }, 0);
    assert.ok(prompt.includes('id="prompt-0-api_id"'));
  });
});

describe('request log', () => {
  test('AC-PERF-LOG-01: the log is bounded', () => {
    const cap = c.LOG_MAX;
    assert.ok(Number.isInteger(cap) && cap > 0, 'LOG_MAX must be a positive integer');
    for (let i = 0; i < cap + 250; i++) c.addLog('req', 'tools/list', { body: { n: i } }, null, null, null);
    assert.equal(c.state.log.length, cap);
    assert.deepEqual(c.state.log[0].body, { n: cap + 249 }, 'the newest entry is first');
    assert.deepEqual(c.state.log[cap - 1].body, { n: 250 }, 'the oldest entries are the ones dropped');
  });
});

describe('redirect fallback', () => {
  function pendingWithSecret() {
    c.auth.pending = {
      state: 'st-1', verifier: 'v', issuer: 'https://as.example', issSupported: true,
      tokenEndpoint: 'https://as.example/token', authMethods: ['client_secret_basic'],
      client: { client_id: 'cc-client', client_secret: 's3cret-value', how: 'pre-registered' },
      resource: 'https://mcp.example/mcp', scope: 'mcp:read', popup: null, boundTo: 'https://mcp.example/mcp',
    };
  }

  test('AC-SEC-SESSION-01: no secret in sessionStorage', () => {
    let stored = null;
    c.sessionStorage.setItem = (k, v) => { stored = v; };
    pendingWithSecret();
    assert.equal(c.savePendingRedirect(), true);
    assert.ok(stored, 'nothing was saved');
    assert.doesNotMatch(stored, /s3cret-value/);
    const hasSecretField = (v) => v && typeof v === 'object' && Object.entries(v).some(([k, x]) => k === 'client_secret' || hasSecretField(x));
    assert.equal(hasSecretField(JSON.parse(stored)), false, 'a client_secret field was persisted');
    assert.equal(JSON.parse(stored).pending.client.client_id, 'cc-client', 'the rest of the client is kept');
    assert.equal(c.auth.pending.client.client_secret, 's3cret-value', 'the in-memory request keeps its secret');
  });

  test('resuming without the secret asks for it instead of sending a token request', () => {
    let stored = null;
    c.sessionStorage.setItem = (k, v) => { stored = v; };
    c.sessionStorage.getItem = () => stored;
    c.sessionStorage.removeItem = () => { stored = null; };
    pendingWithSecret();
    c.savePendingRedirect();
    let fetched = 0;
    c.fetch = () => { fetched++; return new Promise(() => {}); };
    c.location.search = '?code=abc&state=st-1&iss=' + encodeURIComponent('https://as.example');
    c.auth.pending = null;
    c.resumeRedirectSignIn();
    assert.equal(fetched, 0, 'a token request was sent without the client secret');
    const last = c.auth.trace[c.auth.trace.length - 1];
    assert.equal(last.outcome, 'fail');
    assert.match(last.detail, /client secret/i);
    assert.equal(c.auth.busy, false);
  });
});
