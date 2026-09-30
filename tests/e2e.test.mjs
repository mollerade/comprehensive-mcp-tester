/**
 * End-to-end: a real browser drives the UI served by the local Node host,
 * which proxies to the mock MCP server over HTTP. Nothing is stubbed.
 *
 * Skips (rather than fails) when Playwright or a Chromium build isn't available.
 * Install for local runs:  npx playwright install chromium
 * Custom browser:          PW_CHROMIUM_PATH=/path/to/chromium npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/hosts/node-server.js';
import { startMockServer } from './fixtures/mock-mcp-server.mjs';
import { readFileSync } from 'node:fs';
import { build } from '../scripts/build.mjs';

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }

async function launch() {
  if (!chromium) return null;
  // An explicit PW_CHROMIUM_PATH is the only browser tried, so a wrong path is noticed
  const attempts = process.env.PW_CHROMIUM_PATH ? [process.env.PW_CHROMIUM_PATH] : [undefined, '/opt/pw-browsers/chromium'];
  for (const executablePath of attempts) {
    if (executablePath === null) continue;
    try { return await chromium.launch(executablePath ? { executablePath } : {}); } catch { /* try next */ }
  }
  return null;
}

const browser = await launch();
// In CI a missing browser must fail the run: skipping would hide every UI regression
if (!browser && process.env.CI === 'true') {
  throw new Error('Chromium is required when CI=true: run `npx playwright install --with-deps chromium`, or fix PW_CHROMIUM_PATH');
}
const skip = browser ? false : 'Playwright/Chromium not available — run `npx playwright install chromium`';

let mock, server, base, page, firstResponse;
const cspViolations = [];   // every Content-Security-Policy report, from the page and its OAuth pop-ups

before(async () => {
  if (skip) return;
  mock = await startMockServer();
  server = createServer({ allowedTargets: '127.0.0.1', allowedHosts: '', token: '' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const watch = (p) => p.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
  watch(page);
  page.context().on('page', watch);
  firstResponse = await page.goto(base + '/');
});

after(async () => {
  if (skip) return;
  await browser.close();
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  await mock.close();
});

const lastCall = (method) => [...mock.calls].reverse().find((c) => c.body.method === method);
const waitDraftRes = () => page.waitForFunction(() => { const d = window.state.drafts['tool-0']; return d && d.lastRes !== undefined; });

// `state.connected` flips true before fetchAll()'s tools/list round-trips (transport.js),
// so asserting on a recorded call right after waiting for `connected` races the network.
// Poll the mock's own record for the exact (method, path) the assertion needs instead.
// `after` skips calls recorded earlier, so a path reused across tests can't match a stale one.
/** The newest recorded call to `method` (on `path`, if given) at index `after` or later */
function findCall(method, path, after) {
  const matches = (c) => c.body.method === method && (path === undefined || c.path === path);
  return mock.calls.slice(after).reverse().find(matches);
}

async function waitForCall(method, path, { after = 0, timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let found = findCall(method, path, after); !found; found = findCall(method, path, after)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${method}${path ? ' to ' + path : ''}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  return findCall(method, path, after);
}

test('connects through the real proxy and shows server identity', { skip }, async () => {
  await page.fill('#urlInput', mock.url);
  await page.click('#connectBtn');
  await page.waitForFunction(() => window.state.connected && window.state.tools.length === 3);
  assert.match(await page.textContent('#statusText'), /mock-mcp 1\.0\.0/);
  assert.equal(await page.evaluate(() => window.state.tools.length), 3);
});

test('legacy server: modern discover is tried first, then the initialize handshake', { skip }, async () => {
  const discover = lastCall('server/discover');
  assert.equal(discover.headers['mcp-method'], 'server/discover');
  assert.equal(lastCall('initialize').body.params.protocolVersion, '2025-11-25');
  assert.equal(await page.evaluate(() => window.state.era), 'legacy');
  assert.equal(await page.evaluate(() => window.diag.probes.filter((p) => p.method === 'server/discover').length), 0,
    'the expected fallback is not counted as a failure');
});

test('handshake: initialized notification sent without an id, session id reused', { skip }, async () => {
  const note = lastCall('notifications/initialized');
  assert.ok(note && !('id' in note.body));
  assert.ok(lastCall('tools/list').headers['mcp-session-id']);
});

test('transport shows as a single Streamable HTTP indicator', { skip }, async () => {
  assert.equal((await page.textContent('.transport-chip')).trim(), 'Streamable HTTP');
  assert.equal(await page.locator('#transportSelect').count(), 0);
});

test('filter narrows the tool list with a live count, and clears', { skip }, async () => {
  await page.fill('#listFilter', 'payment');
  assert.equal(await page.locator('.item-card').count(), 1);
  assert.equal((await page.textContent('#filterCount')).trim(), '1 of 3');
  await page.click('.filter-clear');
  assert.equal(await page.locator('.item-card').count(), 3);
});

test('expanding a tool suggests a starting request from its schema', { skip }, async () => {
  await page.locator('.item-card').first().click();
  await page.waitForSelector('.detail-panel');
  assert.equal(await page.inputValue('#param-0-category'), 'text', 'required string');
  assert.equal(await page.inputValue('#param-0-mode'), 'summary', 'enum → first value');
  assert.equal(await page.inputValue('#param-0-limit'), '20', 'default');
  assert.equal(await page.inputValue('#param-0-api'), '', 'optional without a hint stays empty');
});

test('required and optional parameters are labelled', { skip }, async () => {
  const tagFor = (name) => page.locator('.param-name', { hasText: name }).locator('.param-tag').textContent();
  assert.equal((await tagFor('category')).trim(), 'required');
  assert.equal((await tagFor('api')).trim(), 'optional');
});

test('form execute sends edited args, omits empty optionals', { skip }, async () => {
  await page.fill('#param-0-category', 'accounts');
  await page.click('#invoke-0');
  await waitDraftRes();
  const args = lastCall('tools/call').body.params.arguments;
  assert.deepEqual(args, { category: 'accounts', mode: 'summary', limit: 20 });
});

test('request and response panels show the raw exchange with status and timing', { skip }, async () => {
  assert.match(await page.textContent('#rr-tool-0 .rr-req'), /"method": "tools\/call"/);
  assert.match(await page.textContent('#rr-tool-0 .rr-res'), /ok: /);
  const meta = await page.textContent('#rr-tool-0 .rr-meta');
  assert.match(meta, /200/);
  assert.match(meta, /origin/);
});

test('JSON mode shows the full request with an auto id', { skip }, async () => {
  await page.click('text=JSON request');
  const req = JSON.parse(await page.inputValue('#jsonta-tool-0'));
  assert.equal(req.id, '(auto)');
  assert.equal(req.method, 'tools/call');
  assert.equal(req.params.arguments.category, 'accounts');
});

test('edited JSON is sent verbatim with a numeric id', { skip }, async () => {
  const req = JSON.parse(await page.inputValue('#jsonta-tool-0'));
  req.params.arguments.category = 'fx';
  req.params.arguments.custom_flag = true;
  await page.fill('#jsonta-tool-0', JSON.stringify(req, null, 2));
  await page.click('#invoke-0');
  await page.waitForFunction(() => JSON.stringify(window.state.drafts['tool-0'].lastRes || '').includes('fx'));
  const sent = lastCall('tools/call').body;
  assert.equal(sent.params.arguments.category, 'fx');
  assert.equal(sent.params.arguments.custom_flag, true);
  assert.equal(typeof sent.id, 'number');
});

test('a JSON-RPC error response is marked as an error', { skip }, async () => {
  const req = JSON.parse(await page.inputValue('#jsonta-tool-0'));
  delete req.params.arguments.category;           // server requires it
  await page.fill('#jsonta-tool-0', JSON.stringify(req, null, 2));
  await page.click('#invoke-0');
  await page.waitForSelector('#rr-tool-0 .rr-err');
  assert.match(await page.textContent('#rr-tool-0 .rr-err'), /Missing required argument: category/);
});

test('invalid JSON is flagged inline and blocks the send', { skip }, async () => {
  await page.fill('#jsonta-tool-0', '{ bad json');
  assert.match(await page.getAttribute('#jsonta-tool-0', 'class'), /invalid/);
  const before = mock.calls.length;
  await page.click('#invoke-0');
  await page.waitForTimeout(300);
  assert.equal(mock.calls.length, before);
  assert.ok(await page.locator('.toast').count() > 0);
});

test('draft survives collapse/expand; reset restores the suggestion', { skip }, async () => {
  await page.locator('.item-card-header').first().click();
  await page.locator('.item-card-header').first().click();
  await page.waitForSelector('#jsonta-tool-0');
  assert.match(await page.inputValue('#jsonta-tool-0'), /bad json/);
  await page.click('text=Reset to suggested');
  await page.waitForSelector('#jsonta-tool-0');
  assert.equal(JSON.parse(await page.inputValue('#jsonta-tool-0')).method, 'tools/call');
});

test('resources and prompts can be read', { skip }, async () => {
  await page.click('.tab-btn[data-tab="resources"]');
  await page.locator('.item-card').first().click();
  await page.click('#read-res-0');
  await page.waitForSelector('#rr-resource-0 .rr-res');
  assert.match(await page.textContent('#rr-resource-0 .rr-res'), /Getting started/);

  await page.click('.tab-btn[data-tab="prompts"]');
  await page.locator('.item-card').first().click();
  await page.fill('#prompt-0-api_id', 'payments-v3');
  await page.click('#get-prompt-0');
  await page.waitForSelector('#rr-prompt-0 .rr-res');
  assert.match(await page.textContent('#rr-prompt-0 .rr-res'), /Summarise payments-v3/);
});

test('log records requests with their HTTP status and timing', { skip }, async () => {
  await page.click('.tab-btn[data-tab="log"]');
  assert.ok(await page.locator('.log-entry').count() > 5);
  assert.ok(await page.locator('.log-entry .http-status.s2xx').count() > 0);
  assert.ok(await page.locator('.log-entry .log-timing').count() > 0);
});

test('diagnostics records every call and a manual probe', { skip }, async () => {
  await page.click('.tab-btn[data-tab="diag"]');
  const before = await page.evaluate(() => window.diag.probes.length);
  assert.ok(before > 0);
  await page.click('text=Probe now');
  await page.waitForFunction((n) => window.diag.probes.length > n, before);
  assert.ok(await page.locator('.kpi-tile').count() === 4);
});

test('theme cycles system → light → dark, persists across reload', { skip }, async () => {
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
  await page.click('#themeBtn');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  await page.click('#themeBtn');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await page.evaluate(() => localStorage.removeItem('mcp_theme'));
});

test('URL survives reload; bookmark saves the server, then opens it for editing', { skip }, async () => {
  assert.equal(await page.inputValue('#urlInput'), mock.url);
  await page.click('#saveBtn');
  await page.waitForSelector('#serverModal:not([hidden])');
  await page.fill('#modalName', 'Mock server');
  await page.click('#serverModal .btn-primary');
  assert.equal(await page.evaluate(() => window.state.servers.length), 1);
  assert.match(await page.getAttribute('#saveBtn', 'class'), /saved/);
  await page.click('#saveBtn');
  assert.equal(await page.textContent('#serverModalTitle'), 'Edit Server');
  assert.equal(await page.inputValue('#modalName'), 'Mock server');
  await page.click('#serverModal .btn-ghost');
});

test('a hanging server fails the connection with a timeout', { skip }, async () => {
  await page.fill('#urlInput', mock.base + '/hang');
  await page.fill('#timeoutInput', '1000');
  await page.click('#connectBtn');
  await page.waitForFunction(() => document.getElementById('statusText').textContent === 'Failed', null, { timeout: 5000 });
  const probe = await page.evaluate(() => window.diag.probes[window.diag.probes.length - 1]);
  assert.equal(probe.errorType, 'timeout');
});

test('2026-07-28 server: stateless, with _meta and mirrored headers on every request', { skip }, async () => {
  await page.fill('#timeoutInput', '15000');
  await page.fill('#urlInput', mock.base + '/modern');
  await page.click('#connectBtn');
  await page.waitForFunction(() => window.state.connected, null, { timeout: 5000 });
  assert.match(await page.textContent('#statusText'), /mock-mcp 1\.0\.0/);
  assert.equal(await page.evaluate(() => window.state.era), 'modern');
  assert.match(await page.getAttribute('#statusPill', 'title'), /2026-07-28 · stateless/);
  assert.equal(await page.evaluate(() => window.state.tools.length), 3);
  const modernCalls = mock.calls.filter((c) => c.path === '/modern');
  assert.ok(!modernCalls.some((c) => c.body.method === 'initialize' || c.body.method.startsWith('notifications/')));
  assert.ok(!modernCalls.some((c) => c.headers['mcp-session-id']));

  await page.click('.tab-btn[data-tab="tools"]');
  await page.locator('.item-card').first().click();
  await page.waitForSelector('#param-0-category');
  await page.fill('#param-0-category', 'accounts');
  await page.click('#invoke-0');
  await waitDraftRes();
  const call = lastCall('tools/call');
  assert.equal(call.path, '/modern');
  assert.equal(call.headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(call.headers['mcp-name'], 'list_account_information_apis');
  assert.equal(call.headers['mcp-param-category'], 'accounts');
  assert.equal(call.body.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  assert.match(await page.textContent('#rr-tool-0 .rr-res'), /"resultType": "complete"/);
  await page.click('#connectBtn');   // disconnect
});

test('dual-era server is spoken to in the modern protocol', { skip }, async () => {
  await page.fill('#urlInput', mock.base + '/dual');
  await page.click('#connectBtn');
  await page.waitForFunction(() => window.state.connected, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.state.era), 'modern');
  assert.ok(!mock.calls.some((c) => c.path === '/dual' && c.body.method === 'initialize'));
  await page.click('#connectBtn');
});

const statusIs = (text) => page.waitForFunction((t) => document.getElementById('statusText').textContent === t, text, { timeout: 5000 });
const traceStep = (name) => page.evaluate((n) => window.auth.trace.find((s) => s.name === n), name);
// The page is already at base + '/', so waiting for that URL resolves at once: wait for the
// callback first, then for the return and the reloaded page's globals.
const signInViaRedirect = async () => {
  await Promise.all([page.waitForURL(/\/oauth\/callback/, { timeout: 10000 }), page.click('#authSignIn')]);
  await page.waitForURL(base + '/', { timeout: 10000 });
  await page.waitForFunction(() => window.state && window.auth, null, { timeout: 10000 });
};

test('OAuth: a 401 opens Auth; sign-in discovers, registers, uses PKCE + resource, then connects', { skip }, async () => {
  const mark = mock.calls.length;
  await page.fill('#urlInput', mock.base + '/secure');
  await page.click('#connectBtn');
  await statusIs('Sign-in required');
  assert.equal(await page.isVisible('#authModal'), true);
  assert.equal(await page.inputValue('#authMode'), 'oauth');
  assert.match(await page.textContent('.auth-challenge'), /resource_metadata=/);

  await page.click('#authSignIn');
  await page.waitForFunction(() => window.state.connected, null, { timeout: 10000 });

  const reg = mock.oauth.registrations.at(-1);
  assert.equal(reg.application_type, 'native', 'a localhost tester registers as a native app');
  assert.deepEqual(reg.redirect_uris, [base + '/oauth/callback']);
  const az = mock.oauth.authorizeRequests.at(-1);
  assert.equal(az.resource, mock.base + '/secure');
  assert.equal(az.code_challenge_method, 'S256');
  assert.equal(az.scope, 'mcp:read', 'scope comes from the WWW-Authenticate challenge');
  const tr = mock.oauth.tokenRequests.at(-1);
  assert.equal(tr.grant_type, 'authorization_code');
  assert.equal(tr.resource, mock.base + '/secure');
  assert.ok(tr.code_verifier && tr.code_verifier.length >= 43);

  const call = await waitForCall('tools/list', '/secure', { after: mark });
  assert.equal(call.path, '/secure');
  assert.match(call.headers.authorization, /^Bearer at-/);
  assert.equal((await traceStep('Issuer check (RFC 9207)')).outcome, 'ok');
  assert.equal((await traceStep('Protected resource metadata')).url, mock.base + '/.well-known/oauth-protected-resource/secure');
  assert.equal(await page.textContent('#authBadge'), 'Token');
});

test('OAuth: tokens and secrets never reach the page as text', { skip }, async () => {
  const token = await page.evaluate(() => window.auth.token.access_token);
  await page.click('.tab-btn[data-tab="log"]');
  assert.ok(await page.locator('.log-method', { hasText: 'oauth \u00b7 Token request' }).count() > 0);
  assert.equal((await page.content()).includes(token), false);
});

test('OAuth: a response with the wrong iss is rejected before the code is used', { skip }, async () => {
  await page.click('#connectBtn');   // disconnect
  const tokenRequests = mock.oauth.tokenRequests.length;
  await page.fill('#urlInput', mock.base + '/secure-mixup');
  await page.click('#connectBtn');
  await statusIs('Sign-in required');
  await page.click('#authSignIn');
  await page.waitForFunction(() => window.auth.trace.some((s) => s.name === 'Issuer check (RFC 9207)'), null, { timeout: 10000 });
  assert.equal((await traceStep('Issuer check (RFC 9207)')).outcome, 'fail');
  assert.match((await traceStep('Client registration')).detail, /Reusing/, 'registration is reused per issuer');
  assert.equal(mock.oauth.tokenRequests.length, tokenRequests, 'the code was never sent to a token endpoint');
  assert.equal(await page.evaluate(() => window.state.connected), false);
});

test('client credentials, no resource_metadata hint: discovery probes the well-known URL', { skip }, async () => {
  await page.click('.modal-actions >> text=Close');
  await page.fill('#urlInput', mock.base + '/secure-nohint');
  await page.click('#connectBtn');
  await statusIs('Sign-in required');
  await page.selectOption('#authMode', 'client_credentials');
  await page.fill('#authClientId', 'cc-client');
  await page.fill('#authClientSecret', 'cc-secret');
  await page.click('#authGetToken');
  await page.waitForFunction(() => window.state.connected, null, { timeout: 10000 });
  assert.equal((await traceStep('Challenge')).outcome, 'warn');
  assert.equal((await traceStep('Protected resource metadata')).url, mock.base + '/.well-known/oauth-protected-resource/secure-nohint');
  const tr = mock.oauth.tokenRequests.at(-1);
  assert.equal(tr.grant_type, 'client_credentials');
  assert.match(tr.authorization, /^Basic /, 'secret goes in Basic auth, as the metadata allows');
  assert.equal(tr.client_secret, undefined);
  assert.equal(tr.resource, mock.base + '/secure-nohint');
  assert.match((await waitForCall('tools/list', '/secure-nohint')).headers.authorization, /^Bearer at-/);
  await page.click('#connectBtn');
});

test('OAuth with pop-ups blocked: the page redirects to sign in and resumes on return', { skip }, async () => {
  const mark = mock.calls.length;
  await page.fill('#urlInput', mock.base + '/secure');
  await page.click('#connectBtn');
  await statusIs('Sign-in required');
  await page.evaluate(() => { window.auth.preIssuer = null; window.open = () => null; });
  await page.selectOption('#authMode', 'oauth');
  // A public client: an earlier test typed client credentials into these fields, and a secret is not kept across a redirect
  await page.fill('#authClientId', '');
  await page.fill('#authClientSecret', '');
  await signInViaRedirect();
  await page.waitForFunction(() => window.state && window.state.connected, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('mcp_oauth_pending')), null, 'pending state is cleared');
  assert.equal(await page.evaluate(() => location.search), '', 'no code left in the address bar');
  const trace = await page.evaluate(() => window.auth.trace.map((s) => s.name + ':' + s.outcome));
  assert.ok(trace.includes('Protected resource metadata:ok'), 'trace from before the redirect survives');
  assert.ok(trace.includes('Token request:ok'));
  assert.match((await waitForCall('tools/list', '/secure', { after: mark })).headers.authorization, /^Bearer at-/);
  await page.click('#connectBtn');
});

test('OAuth with pop-ups blocked and a client secret: the secret is not persisted, and is asked for again', { skip }, async () => {
  const tokensBefore = mock.oauth.tokenRequests.length;
  await page.evaluate(() => window.forgetCredentials());   // the previous test signed in to /secure
  await page.fill('#urlInput', mock.base + '/secure');
  await page.click('#connectBtn');
  await statusIs('Sign-in required');
  await page.evaluate(() => { window.open = () => null; });
  await page.selectOption('#authMode', 'oauth');
  await page.fill('#authClientId', 'cc-client');
  await page.fill('#authClientSecret', 'cc-secret');
  // Record what the page writes to sessionStorage before it navigates away
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(v).includes('cc-secret')) localStorage.setItem('__secretPersisted', '1'); return set.call(this, k, v); };
  });
  await signInViaRedirect();
  await page.waitForFunction(() => window.auth.trace.some((s) => s.name === 'Token request' && s.outcome === 'fail'), null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('__secretPersisted')), null, 'the client secret was written to sessionStorage');
  assert.equal(mock.oauth.tokenRequests.length, tokensBefore, 'a token request was sent without the secret');
  assert.match(await page.evaluate(() => window.auth.trace.at(-1).detail), /client secret is not kept across the redirect/);
  assert.equal(await page.evaluate(() => window.state.connected), false);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('mcp_oauth_pending')), null, 'pending state is cleared');
  await page.fill('#authClientId', '');
  await page.fill('#authClientSecret', '');
  await page.evaluate(() => { localStorage.removeItem('__secretPersisted'); window.auth.preIssuer = null; window.hideAuthModal(); });
});

test('credentials are not sent to a different server', { skip }, async () => {
  const mark = mock.calls.length;
  await page.fill('#urlInput', mock.url);
  await page.click('#connectBtn');
  await page.waitForFunction(() => window.state.connected, null, { timeout: 5000 });
  assert.equal((await waitForCall('tools/list', '/mcp', { after: mark })).headers.authorization, undefined);
  await page.click('#connectBtn');
});

// Connecting flips `state.connected` before fetchAll() returns, so the user can switch
// servers while the old server's tools/list is still in flight (/slow-list holds it 800ms).
async function connectSlowList() {
  if (await page.evaluate(() => window.state.connected)) await page.click('#connectBtn');
  const mark = mock.calls.length;
  await page.fill('#urlInput', mock.base + '/slow-list');
  await page.click('#connectBtn');
  await page.waitForFunction(() => window.state.connected, null, { timeout: 5000 });
  await waitForCall('tools/list', '/slow-list', { after: mark });
}
const waitPastSlowList = () => new Promise((r) => setTimeout(r, 1200));

test('AC-BUG-CONNGEN-01: a stale response is ignored', { skip }, async () => {
  await connectSlowList();
  await page.click('#connectBtn');                                  // disconnect from A
  await page.fill('#urlInput', mock.url);
  await page.click('#connectBtn');                                  // connect to B
  await page.waitForFunction(() => window.state.connected && window.state.tools.length === 3, null, { timeout: 5000 });
  await waitPastSlowList();
  const names = await page.evaluate(() => window.state.tools.map((t) => t.name));
  assert.equal(names.includes('slow_list_tool'), false, 'A\'s late tools/list wrote into B: ' + names.join(', '));
  assert.equal(names.length, 3);
  await page.click('#connectBtn');
});

test('AC-BUG-CONNGEN-02: disconnect invalidates in-flight work', { skip }, async () => {
  await connectSlowList();
  await page.click('#connectBtn');                                  // disconnect while tools/list is in flight
  await waitPastSlowList();
  assert.deepEqual(await page.evaluate(() => window.state.tools), []);
  assert.equal(await page.textContent('#toolsBadge'), '0');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('slow_list_tool')), false);
});

test('AC-QA-VERSION-07: built artefacts carry the version', { skip }, async () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { sw, mod } = build({ write: false });
  for (const bundle of [sw, mod]) {
    const first = bundle.split('\n')[0];
    assert.ok(first.includes('MCP Tester v' + version + ':'), 'first line does not name v' + version + ': ' + first);
  }
  assert.equal((await page.textContent('#appVersion')).trim(), 'v' + version);
});

test('no horizontal overflow at phone width', { skip }, async () => {
  await page.setViewportSize({ width: 400, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
});

test('AC-SEC-CSP-02: the app still functions under the policy', { skip }, async () => {
  const csp = firstResponse.headers()['content-security-policy'];
  assert.ok(csp && csp.includes("connect-src 'self'"), 'the page was not served with the policy');
  // Runs last: every flow above (connect, both eras, sign-in with pop-up and redirect, execute,
  // diagnostics, theme) has run under the policy by now, and none may have been blocked.
  assert.deepEqual(cspViolations, []);
});
