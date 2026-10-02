/**
 * Streamable HTTP transport and session rules (#10).
 */
import { RULES_HTTP_VERSIONS, RULES_SESSION_VERSIONS, RULES_MODERN_VERSIONS, RULES_NO_ANSWER, rulesSpec, rulesExchange, rulesAnswered, rulesFirst } from './helpers.js';

const TRANSPORT_SPEC = rulesSpec('2025-11-25', 'basic/transports');
const MODERN_TRANSPORT_SPEC = rulesSpec('2026-07-28', 'basic/transports');
const NO_SESSION = { skip: 'the server issued no session id, which the session era allows' };

/** The probe, answered, or null */
function transportProbe(ctx, label) {
  const e = rulesExchange(ctx, label);
  return e && !e.transportError ? e : null;
}

const errorCode = (e) => e.response && e.response.error ? e.response.error.code : undefined;

function statusRule(id, title, label, want, opts) {
  return {
    id, title, category: opts.category || 'transport', severity: opts.severity || 'fail',
    appliesTo: opts.appliesTo, specRef: opts.specRef,
    check: function (ctx) {
      const e = transportProbe(ctx, label);
      if (!e) return opts.skip || RULES_NO_ANSWER;
      if (e.status === want.status && (want.code === undefined || errorCode(e) === want.code)) return { ok: true };
      return { ok: false, message: label + ': HTTP ' + e.status + (errorCode(e) !== undefined ? ' with error ' + errorCode(e) : '') +
        ', expected HTTP ' + want.status + (want.code !== undefined ? ' with error ' + want.code : ''), evidence: { status: e.status, response: e.response } };
    },
  };
}

export const TRANSPORT_RULES = [
  {
    id: 'MCP-HTTP-001', title: 'A successful response is application/json or text/event-stream', category: 'transport', severity: 'fail',
    appliesTo: RULES_HTTP_VERSIONS, specRef: TRANSPORT_SPEC,
    check: function (ctx) {
      const bodies = rulesAnswered(ctx).filter((e) => e.status >= 200 && e.status < 300 && e.raw);
      if (!bodies.length) return RULES_NO_ANSWER;
      const wrong = bodies.filter((e) => !/^(application\/json|text\/event-stream)\b/i.test(e.contentType));
      return rulesFirst(wrong.map((e) => ({ probe: e.label, contentType: e.contentType })),
        (p) => p.probe + ': Content-Type is "' + (p.contentType || '(none)') + '"');
    },
  },
  {
    id: 'MCP-HTTP-002', title: 'A notification is accepted with HTTP 202 and no body', category: 'transport', severity: 'fail',
    appliesTo: RULES_HTTP_VERSIONS, specRef: TRANSPORT_SPEC,
    check: function (ctx) {
      const e = transportProbe(ctx, 'notification');
      if (!e) return RULES_NO_ANSWER;
      if (e.status === 202 && !e.raw) return { ok: true };
      return { ok: false, message: 'a notification got HTTP ' + e.status + (e.raw ? ' with a body' : '') + ', expected 202 with no body', evidence: { status: e.status, body: e.raw.slice(0, 200) } };
    },
  },
  statusRule('MCP-HTTP-003', 'An unknown method is answered with HTTP 404', 'unknown method', { status: 404, code: -32601 },
    { appliesTo: RULES_MODERN_VERSIONS, specRef: MODERN_TRANSPORT_SPEC }),
  statusRule('MCP-HTTP-004', 'A header that contradicts the body is rejected with HTTP 400 and error -32020', 'header mismatch', { status: 400, code: -32020 },
    { appliesTo: RULES_MODERN_VERSIONS, specRef: MODERN_TRANSPORT_SPEC }),
  statusRule('MCP-SESS-001', 'A request without the session id is rejected with HTTP 400', 'no session', { status: 400 },
    { category: 'session', severity: 'warn', appliesTo: RULES_SESSION_VERSIONS, specRef: TRANSPORT_SPEC, skip: NO_SESSION }),
  statusRule('MCP-SESS-002', 'A request with an unknown session id is answered with HTTP 404', 'unknown session', { status: 404 },
    { category: 'session', appliesTo: RULES_SESSION_VERSIONS, specRef: TRANSPORT_SPEC, skip: NO_SESSION }),
];
