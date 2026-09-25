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

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }

async function launch() {
  if (!chromium) return null;
  const attempts = [process.env.PW_CHROMIUM_PATH, undefined, '/opt/pw-browsers/chromium'];
  for (const executablePath of attempts) {
    if (executablePath === null) continue;
    try { return await chromium.launch(executablePath ? { executablePath } : {}); } catch { /* try next */ }
  }
  return null;
}

const browser = await launch();
const skip = browser ? false : 'Playwright/Chromium not available — run `npx playwright install chromium`';

let mock, server, base, page;

before(async () => {
  if (skip) return;
  mock = await startMockServer();
  server = createServer({ allowedOrigins: '', allowedHosts: '' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(base + '/');
});

after(async () => {
  if (skip) return;
  await browser.close();
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  await mock.close();
});

const lastCall = (method) => [...mock.calls].reverse().find((c) => c.body.method === method);
const waitDraftRes = () => page.waitForFunction(() => { const d = window.state.drafts['tool-0']; return d && d.lastRes !== undefined; });

test('connects through the real proxy and shows server identity', { skip }, async () => {
  await page.fill('#urlInput', mock.url);
  await page.click('#connectBtn');
  await page.waitForFunction(() => window.state.connected);
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

test('no horizontal overflow at phone width', { skip }, async () => {
  await page.setViewportSize({ width: 400, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
});
