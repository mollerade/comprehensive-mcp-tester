/**
 * Shared set-up for browser end-to-end suites: a real Chromium drives the UI
 * served by the local Node host, which proxies to the mock MCP server.
 *
 *   const h = await e2eHarness();      // registers before/after for this test file
 *   test('...', { skip: h.skip }, async () => { await h.page.click(...) });
 *
 * Skips (rather than fails) without Playwright or Chromium, except when CI=true.
 */
import { before, after } from 'node:test';
import { createServer } from '../../src/hosts/node-server.js';
import { startMockServer } from './mock-mcp-server.mjs';

async function launch() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return null; }
  // An explicit PW_CHROMIUM_PATH is the only browser tried, so a wrong path is noticed
  const attempts = process.env.PW_CHROMIUM_PATH ? [process.env.PW_CHROMIUM_PATH] : [undefined, '/opt/pw-browsers/chromium'];
  for (const executablePath of attempts) {
    try { return await chromium.launch(executablePath ? { executablePath } : {}); } catch { /* try next */ }
  }
  return null;
}

export async function e2eHarness() {
  const browser = await launch();
  if (!browser && process.env.CI === 'true') {
    throw new Error('Chromium is required when CI=true: run `npx playwright install --with-deps chromium`, or fix PW_CHROMIUM_PATH');
  }
  const h = { skip: browser ? false : 'Playwright/Chromium not available — run `npx playwright install chromium`' };
  let server;

  before(async () => {
    if (h.skip) return;
    h.mock = await startMockServer();
    // The mock runs on loopback, which the proxy reaches only when it is listed
    server = createServer({ allowedTargets: '127.0.0.1', allowedHosts: '', token: '' });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    h.base = `http://127.0.0.1:${server.address().port}`;
    h.page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await h.page.goto(h.base + '/');
  });

  after(async () => {
    if (h.skip) return;
    await browser.close();
    await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
    await h.mock.close();
  });

  /** The newest call to `method` on `path` recorded at index `after` or later; waits for it */
  h.waitForCall = async (method, path, { after: from = 0, timeoutMs = 10000 } = {}) => {
    const find = () => h.mock.calls.slice(from).reverse().find((c) => c.body.method === method && (path === undefined || c.path === path));
    const deadline = Date.now() + timeoutMs;
    while (!find()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${method}${path ? ' to ' + path : ''}`);
      await new Promise((r) => setTimeout(r, 25));
    }
    return find();
  };
  h.statusIs = (text) => h.page.waitForFunction((t) => document.getElementById('statusText').textContent === t, text, { timeout: 5000 });
  h.traceStep = (name) => h.page.evaluate((n) => window.auth.trace.find((s) => s.name === n), name);
  return h;
}
