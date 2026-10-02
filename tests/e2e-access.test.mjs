/**
 * End-to-end, as e2e.test.mjs: what the proxy refuses, and how credentials are kept
 * and renewed (token refresh, client credentials under custom names, the issuer switch).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { e2eHarness } from './fixtures/e2e-harness.mjs';

const h = await e2eHarness();

test('AC-SEC-PROXY-10: a refused target shows as a failed connection with the proxy\'s hint', { skip: h.skip }, async () => {
  if (await h.page.evaluate(() => window.state.connected)) await h.page.click('#connectBtn');
  const mark = h.mock.calls.length;
  // localhost is a loopback name and only 127.0.0.1 is listed for this server
  await h.page.fill('#urlInput', h.mock.url.replace('127.0.0.1', 'localhost'));
  await h.page.click('#connectBtn');
  await h.page.waitForFunction(() => window.diag.probes.some((p) => p.errorType === 'proxy'), null, { timeout: 5000 });
  assert.equal(await h.page.evaluate(() => window.state.connected), false);
  assert.equal(h.mock.calls.length, mark, 'the mock was never contacted');
  assert.equal(await h.page.isVisible('#authModal'), false, 'a refusal is not an auth challenge');
  await h.page.click('.tab-btn[data-tab="log"]');
  assert.ok(await h.page.locator('text=MCP_TESTER_ALLOWED_TARGETS').count() > 0, 'the hint reaches the Log');
});

// ── Token renewal, custom client credentials, issuer-mismatch switch ──
async function resetAuth() {
  if (await h.page.evaluate(() => window.state.connected)) await h.page.click('#connectBtn');
  await h.page.evaluate(() => {
    window.forgetCredentials();
    Object.assign(window.auth, { mode: 'none', challenge: null, preIssuer: null, clientId: '', scope: '', tokenEndpoint: '',
      allowIssuerMismatch: false, ccStyle: 'standard', ccBodyFormat: 'form', ccStandardParams: true });
    window.hideAuthModal();
  });
  await h.page.click('.tab-btn[data-tab="tools"]');
}
async function openSignIn(path) {
  await resetAuth();
  await h.page.fill('#urlInput', h.mock.base + path);
  await h.page.click('#connectBtn');
  await h.statusIs('Sign-in required');
}
async function signInTo(path) {
  await openSignIn(path);
  await h.page.selectOption('#authMode', 'oauth');
  const mark = h.mock.calls.length;
  await h.page.click('#authSignIn');
  await h.waitForCall('tools/list', path, { after: mark });
  await h.page.waitForFunction(() => window.state.connected, null, { timeout: 5000 });
}
const tokenRequestsSince = (n) => h.mock.oauth.tokenRequests.slice(n);

test('AC-AUTH-RENEW-01: a token about to expire is refreshed before the request', { skip: h.skip }, async () => {
  await signInTo('/secure');
  assert.ok(await h.page.evaluate(() => !!window.auth.token.refresh_token), 'the sign-in kept the refresh token');
  const oldToken = await h.page.evaluate(() => window.auth.token.access_token);
  const tokens = h.mock.oauth.tokenRequests.length, mark = h.mock.calls.length;
  await h.page.evaluate(() => { window.auth.token.expires_at = Date.now() + 5000; });
  await h.page.evaluate(() => window.rpc('tools/list'));
  const tr = tokenRequestsSince(tokens);
  assert.equal(tr.length, 1);
  assert.equal(tr[0].grant_type, 'refresh_token');
  assert.equal(tr[0].resource, h.mock.base + '/secure', 'RFC 8707 resource on the refresh too');
  const call = await h.waitForCall('tools/list', '/secure', { after: mark });
  assert.match(call.headers.authorization, /^Bearer at-/);
  assert.notEqual(call.headers.authorization, 'Bearer ' + oldToken, 'the renewed token was sent');
  assert.equal((await h.traceStep('Token refresh')).outcome, 'ok');
});

test('AC-AUTH-RENEW-02: a 401 to the current token renews it once and resends', { skip: h.skip }, async () => {
  h.mock.oauth.expireAccessTokens();
  const tokens = h.mock.oauth.tokenRequests.length;
  const r = await h.page.evaluate(() => window.rpc('tools/list'));
  assert.equal(r.result.tools.length, 3, 'the resent request succeeded');
  const tr = tokenRequestsSince(tokens);
  assert.deepEqual(tr.map((t) => t.grant_type), ['refresh_token'], 'renewed exactly once, with the rotated refresh token');
  await h.page.click('.tab-btn[data-tab="log"]');
  assert.ok(await h.page.locator('.log-method', { hasText: 'resent with the renewed token' }).count() > 0);
  const token = await h.page.evaluate(() => window.auth.token.access_token + ' ' + window.auth.token.refresh_token);
  for (const t of token.split(' ')) assert.equal((await h.page.content()).includes(t), false, 'tokens stay out of the page');
});

test('AC-AUTH-RENEW-03: a renewal that fails is not retried on every call', { skip: h.skip }, async () => {
  h.mock.oauth.expireAccessTokens();
  h.mock.oauth.refreshTokens.clear();
  const tokens = h.mock.oauth.tokenRequests.length;
  const first = await h.page.evaluate(() => window.rpc('tools/list'));
  assert.ok(first.error, 'the 401 is shown as it is');
  assert.equal(tokenRequestsSince(tokens).length, 1);
  assert.equal(await h.page.evaluate(() => window.auth.trace.filter((s) => s.name === 'Token refresh').at(-1).outcome), 'fail');
  assert.equal(await h.page.evaluate(() => window.auth.token.renew), null);
  await h.page.evaluate(() => window.rpc('tools/list'));
  assert.equal(tokenRequestsSince(tokens).length, 1, 'no second renewal attempt');
});

test('AC-AUTH-RENEW-04: a client credentials token is renewed with the client credentials', { skip: h.skip }, async () => {
  await openSignIn('/secure-nohint');
  await h.page.selectOption('#authMode', 'client_credentials');
  await h.page.fill('#authClientId', 'cc-client');
  await h.page.fill('#authClientSecret', 'cc-secret');
  await h.page.click('#authGetToken');
  await h.page.waitForFunction(() => window.state.connected, null, { timeout: 10000 });
  h.mock.oauth.expireAccessTokens();
  const tokens = h.mock.oauth.tokenRequests.length;
  const r = await h.page.evaluate(() => window.rpc('tools/list'));
  assert.equal(r.result.tools.length, 3);
  const tr = tokenRequestsSince(tokens);
  assert.equal(tr.length, 1);
  assert.equal(tr[0].grant_type, 'client_credentials');
  assert.match(tr[0].authorization, /^Basic /);
  assert.equal((await h.traceStep('Token renewal (client credentials)')).outcome, 'ok');
});

test('AC-AUTH-CUSTOM-CC-01: client credentials under custom field names, as JSON', { skip: h.skip }, async () => {
  const path = '/scenario/custom-credentials/mcp';
  await openSignIn(path);
  await h.page.selectOption('#authMode', 'client_credentials');
  await h.page.fill('#authClientId', 'bank-profile');
  await h.page.fill('#authClientSecret', 'bank-secret');
  await h.page.selectOption('#authCcStyle', 'custom');
  assert.equal(await h.page.inputValue('#authCcIdField'), 'profileID');
  assert.equal(await h.page.inputValue('#authCcSecretField'), 'secret');
  await h.page.selectOption('#authCcBodyFormat', 'json');
  const mark = h.mock.calls.length;
  await h.page.click('#authGetToken');
  await h.waitForCall('tools/list', path, { after: mark });
  const tr = h.mock.oauth.tokenRequests.at(-1);
  assert.equal(tr.path, '/token-custom', 'the token endpoint came from discovery');
  assert.match(tr.contentType, /application\/json/);
  assert.equal(tr.profileID, 'bank-profile');
  assert.equal(tr.secret, 'bank-secret');
  assert.equal(tr.grant_type, 'client_credentials');
  assert.equal(tr.resource, h.mock.base + path);
  assert.equal(tr.client_id, undefined);
  assert.equal(tr.authorization, null, 'no Basic auth in custom mode');
  await h.page.click('.tab-btn[data-tab="log"]');
  // The Log's stored entries plus its rendered text (collapsed bodies are in the DOM too)
  const logText = await h.page.evaluate(() => JSON.stringify(window.state.log) + document.getElementById('tabContent').textContent);
  assert.match(logText, /profileID/, 'the request is in the Log');
  assert.equal(logText.includes('bank-secret'), false, 'the custom secret field is redacted from the Log');

  h.mock.oauth.expireAccessTokens();
  const tokens = h.mock.oauth.tokenRequests.length;
  assert.equal((await h.page.evaluate(() => window.rpc('tools/list'))).result.tools.length, 3);
  assert.equal(tokenRequestsSince(tokens)[0].path, '/token-custom', 'renewal uses the same custom request');
});

test('AC-AUTH-CUSTOM-CC-02: only the two custom fields, as a form', { skip: h.skip }, async () => {
  const path = '/scenario/custom-credentials/mcp';
  await openSignIn(path);
  await h.page.selectOption('#authMode', 'client_credentials');
  await h.page.fill('#authClientId', 'bank-profile');
  await h.page.fill('#authClientSecret', 'bank-secret');
  await h.page.selectOption('#authCcStyle', 'custom');
  await h.page.uncheck('#authCcStandardParams');
  const mark = h.mock.calls.length;
  await h.page.click('#authGetToken');
  await h.waitForCall('tools/list', path, { after: mark });
  const tr = h.mock.oauth.tokenRequests.at(-1);
  assert.match(tr.contentType, /application\/x-www-form-urlencoded/);
  const sent = Object.keys(tr).filter((k) => !['contentType', 'authorization', 'path'].includes(k)).sort();
  assert.deepEqual(sent, ['profileID', 'secret']);
});

test('AC-AUTH-ISSUER-OVERRIDE-01: an issuer mismatch stops discovery by default', { skip: h.skip }, async () => {
  await openSignIn('/scenario/as-issuer-mismatch/mcp');
  assert.equal(await h.page.isChecked('#authIssuerMismatch'), false, 'off by default');
  const authorizes = h.mock.oauth.authorizeRequests.length;
  await h.page.click('#authSignIn');
  await h.page.waitForFunction(() => !window.auth.busy, null, { timeout: 10000 });
  const step = await h.traceStep('Authorization server metadata');
  assert.equal(step.outcome, 'fail');
  assert.match(step.detail, /RFC 8414/);
  assert.match(step.detail, /Continue past an issuer mismatch/, 'the failure names the switch');
  assert.equal(h.mock.oauth.authorizeRequests.length, authorizes, 'no authorization request was made');
  assert.equal(await h.page.evaluate(() => window.state.connected), false);
});

test('AC-AUTH-ISSUER-OVERRIDE-02: with the switch on, discovery continues with a warning', { skip: h.skip }, async () => {
  const path = '/scenario/as-issuer-mismatch/mcp';
  await h.page.check('#authIssuerMismatch');
  await h.page.evaluate(() => window.onAuthModeChange());
  assert.ok(await h.page.locator('#authModal .auth-note.warn', { hasText: 'Only for testing' }).count() > 0, 'a visible warning');
  const mark = h.mock.calls.length;
  await h.page.click('#authSignIn');
  await h.waitForCall('tools/list', path, { after: mark });
  const warn = await h.traceStep('Issuer check (RFC 8414)');
  assert.equal(warn.outcome, 'warn');
  assert.match(warn.detail, /compliant client must stop/);
  assert.equal((await h.traceStep('Issuer check (RFC 9207)')).outcome, 'ok', 'the authorization response iss is still checked');
  await resetAuth();
});


// ── Compliance tab (#13) ──
async function runCheck(url) {
  await h.page.click('.tab-btn[data-tab="compliance"]');
  await h.page.fill('#urlInput', url);
  await h.page.click('#complianceRun');
  await h.page.waitForFunction(() => !window.state.compliance.running, null, { timeout: 20000 });
}

test('AC-SPEC-REPORT-04: the Compliance tab runs the check and shows the verdict and findings', { skip: h.skip }, async () => {
  await resetAuth();
  await runCheck(h.mock.url);
  assert.equal(await h.page.textContent('#complianceVerdict'), 'Pass');
  assert.equal(await h.page.isVisible('#complianceBadge'), true);
  assert.equal(await h.page.textContent('#complianceBadge'), '0');

  await runCheck(h.mock.base + '/scenario/id-mismatch/mcp');
  assert.equal(await h.page.textContent('#complianceVerdict'), 'Fail');
  const row = h.page.locator('#complianceResults li[data-rule="MCP-RPC-002"]');
  assert.equal(await row.getAttribute('data-status'), 'fail');
  assert.match(await row.textContent(), /does not match request id/);
  assert.match(await row.locator('a.cmp-rule').getAttribute('href'), /^https:\/\/modelcontextprotocol\.io\//);
  await row.locator('details.cmp-evidence summary').click();
  assert.match(await row.locator('details.cmp-evidence pre').textContent(), /requestId/);
  assert.equal(await h.page.locator('#complianceResults li[data-status="not-applicable"]').count(), 0, 'quiet results are folded away');
  assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
});

test('AC-SPEC-REPORT-05: the report exports as Markdown and JSON', { skip: h.skip }, async () => {
  const md = await h.page.evaluate(() => window.state.compliance.result.markdown);
  assert.match(md, /\| FAIL \| \[MCP-RPC-002\]/);
  await h.page.evaluate(() => { window.__copied = null; window.copyText = (t) => { window.__copied = t; }; });
  await h.page.click('#complianceCopy');
  assert.equal(await h.page.evaluate(() => window.__copied), md);
  const [download] = await Promise.all([h.page.waitForEvent('download'), h.page.click('#complianceJson')]);
  assert.match(download.suggestedFilename(), /^mcp-compliance-.*\.json$/);
  const json = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  assert.equal(json.report.verdict, 'fail');
  assert.equal(json.target, h.mock.base + '/scenario/id-mismatch/mcp');
});

test('AC-SPEC-REPORT-06: credentials bound to the server are used; a protected server without them grades authorization only', { skip: h.skip }, async () => {
  await runCheck(h.mock.base + '/secure');
  assert.match(await h.page.textContent('.cmp-caveat'), /Only authorization was graded.*Sign in from Auth/);
  assert.equal(await h.page.locator('#complianceResults li[data-rule="MCP-AUTH-005"]').getAttribute('data-status'), 'pass');

  await signInTo('/secure');   // bound to /secure, so the check may use the token
  await runCheck(h.mock.base + '/secure');
  assert.equal(await h.page.evaluate(() => window.state.compliance.result.summary.era), 'legacy', 'signed in, the protocol is graded');
  assert.equal(await h.page.textContent('#complianceVerdict'), 'Pass');
  const token = await h.page.evaluate(() => window.auth.token.access_token);
  assert.equal((await h.page.content()).includes(token), false);

  await runCheck(h.mock.url);   // another server: the token is not sent there
  const sent = h.mock.calls.filter((c) => c.path === '/mcp').slice(-3);
  assert.ok(sent.every((c) => c.headers.authorization === undefined));
  await resetAuth();
});

test('AC-SPEC-REPORT-07: Cancel stops the check', { skip: h.skip }, async () => {
  await h.page.click('.tab-btn[data-tab="compliance"]');
  await h.page.fill('#urlInput', h.mock.url + '?delay=400');
  await h.page.click('#complianceRun');
  await h.page.waitForSelector('#complianceCancel');
  await h.page.click('#complianceCancel');
  await h.page.waitForFunction(() => !window.state.compliance.running, null, { timeout: 5000 });
  assert.equal(await h.page.textContent('#complianceError'), 'Check cancelled');
  assert.equal(await h.page.isVisible('#complianceRun'), true);
  await h.page.click('.tab-btn[data-tab="tools"]');
});
