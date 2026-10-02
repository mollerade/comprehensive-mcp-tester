/**
 * Authorization rules (#12), graded from the discovery the collector follows
 * after a 401 (collect-auth.js): the challenge, the protected resource
 * metadata and the authorization server metadata. Revisions before 2025-06-18
 * used a different discovery, so these rules start there.
 */
import { rulesSpec, rulesIsObject } from './helpers.js';

const AUTH_VERSIONS = ['2025-06-18', '2025-11-25', '2026-07-28'];
const AUTH_CIMD_VERSIONS = ['2025-11-25', '2026-07-28'];
const AUTH_SPEC = rulesSpec('2025-11-25', 'basic/authorization');
const AUTH_NOT_ASKED = { skip: 'the server did not ask for authorization' };
const AUTH_NO_PRM = { skip: 'no protected resource metadata was found' };
const AUTH_NO_AS = { skip: 'no authorization server metadata was found' };

function authLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** https, or http on loopback for local testing */
function authSafeUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' || (u.protocol === 'http:' && authLoopback(u.hostname));
}

const authTried = (step) => step.attempts.map((a) => a.url + ' → ' + (a.error || 'HTTP ' + a.status)).join('; ');

/** A rule over ctx.auth; `needs` is 'prm' or 'as' when it reads that document */
function authRule(id, title, severity, appliesTo, needs, check) {
  return {
    id, title, category: 'auth', severity, appliesTo, specRef: AUTH_SPEC,
    check: function (ctx) {
      const a = ctx.auth;
      if (!a) return AUTH_NOT_ASKED;
      if (needs && !(a[needs] && a[needs].found)) return needs === 'prm' ? AUTH_NO_PRM : AUTH_NO_AS;
      return check(a);
    },
  };
}

const authFail = (message, evidence) => ({ ok: false, message, evidence });

function prmProblem(a) {
  const doc = a.prm.found.doc, list = doc.authorization_servers;
  if (!Array.isArray(list) || !list.length) return 'authorization_servers is missing or empty';
  if (!a.issuer) return 'the first authorization server, ' + JSON.stringify(list[0]) + ', is not a URL';
  return null;
}

function issuerProblemOf(a) {
  const doc = a.as.found.doc;
  if (doc.issuer === a.issuer) return null;
  return 'the metadata at ' + a.as.found.url + ' says issuer ' + JSON.stringify(doc.issuer) + ', but the resource names ' +
    JSON.stringify(a.issuer) + '; RFC 8414 §3.3 says a client must not use it';
}

function endpointProblems(doc) {
  const out = [];
  for (const key of ['authorization_endpoint', 'token_endpoint']) {
    if (typeof doc[key] !== 'string') out.push(key + ' is missing');
    else if (!authSafeUrl(doc[key])) out.push(key + ' ' + JSON.stringify(doc[key]) + ' is not https');
  }
  return out;
}

function registrationNote(doc) {
  if (doc.client_id_metadata_document_supported === true) return null;
  if (doc.registration_endpoint) return 'no client ID metadata document support, so clients fall back to dynamic registration';
  return 'neither client ID metadata documents nor dynamic registration, so every client must be pre-registered';
}

export const AUTH_RULES = [
  authRule('MCP-AUTH-001', 'A 401 carries a Bearer WWW-Authenticate challenge', 'fail', AUTH_VERSIONS, null, (a) => {
    if (a.challenge.status !== 401) return { skip: 'the server answered ' + a.challenge.status + ', not 401' };
    if (a.challenge.scheme === 'Bearer') return { ok: true };
    return authFail(a.challenge.header ? 'WWW-Authenticate is "' + a.challenge.header + '", not a Bearer challenge' : 'the 401 has no WWW-Authenticate header', a.challenge);
  }),
  authRule('MCP-AUTH-002', 'The challenge points at the protected resource metadata', 'warn', AUTH_VERSIONS, null, (a) => {
    const hint = a.challenge.params.resource_metadata;
    if (!hint) return authFail('the challenge has no resource_metadata, so clients must guess the well-known URLs', a.challenge);
    return authSafeUrl(hint) ? { ok: true } : authFail('resource_metadata ' + JSON.stringify(hint) + ' is not an https URL', a.challenge);
  }),
  authRule('MCP-AUTH-003', 'Protected resource metadata names an authorization server', 'fail', AUTH_VERSIONS, null, (a) => {
    if (!a.prm.found) return authFail('no protected resource metadata at: ' + authTried(a.prm), a.prm.attempts);
    const p = prmProblem(a);
    return p ? authFail('protected resource metadata at ' + a.prm.found.url + ': ' + p, a.prm.found.doc) : { ok: true };
  }),
  authRule('MCP-AUTH-004', 'Protected resource metadata is for this resource', 'warn', AUTH_VERSIONS, 'prm', (a) => {
    const r = a.prm.found.doc.resource, origin = new URL(a.resource).origin;
    if (r === a.resource || r === origin) return { ok: true };
    return authFail('the metadata says resource ' + JSON.stringify(r) + ', but the server is ' + a.resource + ' (RFC 9728 §3.3)', a.prm.found.doc);
  }),
  authRule('MCP-AUTH-005', 'Authorization server metadata exists and its issuer matches', 'fail', AUTH_VERSIONS, null, (a) => {
    if (!a.issuer) return AUTH_NO_PRM;
    if (!a.as.found) return authFail('no authorization server metadata for ' + a.issuer + ' at: ' + authTried(a.as), a.as.attempts);
    const p = issuerProblemOf(a);
    return p ? authFail(p, { url: a.as.found.url, issuer: a.as.found.doc.issuer, expected: a.issuer }) : { ok: true };
  }),
  authRule('MCP-AUTH-006', 'The authorization server supports PKCE with S256', 'fail', AUTH_VERSIONS, 'as', (a) => {
    const m = a.as.found.doc.code_challenge_methods_supported;
    if (Array.isArray(m) && m.indexOf('S256') !== -1) return { ok: true };
    return authFail(Array.isArray(m) ? 'code_challenge_methods_supported is ' + JSON.stringify(m) + ', without S256'
      : 'code_challenge_methods_supported is missing, so PKCE support cannot be confirmed', { code_challenge_methods_supported: m });
  }),
  authRule('MCP-AUTH-007', 'The authorization and token endpoints exist and are https', 'fail', AUTH_VERSIONS, 'as', (a) => {
    const problems = endpointProblems(a.as.found.doc);
    return problems.length ? authFail(problems.join('; '), a.as.found.doc) : { ok: true };
  }),
  authRule('MCP-AUTH-008', 'Clients can register: client ID metadata documents are supported', 'warn', AUTH_CIMD_VERSIONS, 'as', (a) => {
    const note = registrationNote(a.as.found.doc);
    return note ? authFail('the authorization server offers ' + note, a.as.found.doc) : { ok: true };
  }),
  authRule('MCP-AUTH-009', 'The authorization server returns iss in the authorization response (RFC 9207)', 'warn', AUTH_CIMD_VERSIONS, 'as', (a) => {
    if (rulesIsObject(a.as.found.doc) && a.as.found.doc.authorization_response_iss_parameter_supported === true) return { ok: true };
    return authFail('authorization_response_iss_parameter_supported is not true, so clients cannot detect a mix-up attack', a.as.found.doc);
  }),
];
