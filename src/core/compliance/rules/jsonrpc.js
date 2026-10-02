/**
 * JSON-RPC 2.0 message rules (#10): every revision speaks it.
 */
import { RULES_ALL_VERSIONS, RULES_NO_ANSWER, rulesSpec, rulesExchange, rulesAnswered, rulesResponses, rulesFirst, rulesIsObject } from './helpers.js';

const JSONRPC_SPEC = rulesSpec('2025-11-25', 'basic');

/** Messages that look like JSON-RPC (a result, an error or a method) but are not "jsonrpc": "2.0", plus unparsable 2xx bodies */
function jsonrpcVersionProblems(ctx) {
  const problems = [];
  for (const e of rulesAnswered(ctx)) {
    for (const m of e.messages) {
      if (m.unparsable !== undefined && e.status < 300) problems.push({ probe: e.label, problem: 'not JSON', body: m.unparsable });
      else if (rulesIsObject(m) && ('result' in m || 'error' in m || 'method' in m) && m.jsonrpc !== '2.0') problems.push({ probe: e.label, jsonrpc: m.jsonrpc });
    }
  }
  return problems;
}

/** The response id must be the request's; null only on an error the server could not tie to a request */
function idProblem(e) {
  const want = e.request.body.id, got = e.response.id;
  if (got === want) return null;
  if (got === null && e.response.error) return null;
  return { probe: e.label, requestId: want, responseId: got };
}

function shapeProblem(e) {
  const m = e.response;
  if (('result' in m) === ('error' in m)) return { probe: e.label, problem: 'needs exactly one of result and error' };
  if ('error' in m && (!rulesIsObject(m.error) || !Number.isInteger(m.error.code) || typeof m.error.message !== 'string')) {
    return { probe: e.label, problem: 'error needs an integer code and a string message', error: m.error };
  }
  return null;
}

const jsonrpcPresent = (x) => x;

export const JSONRPC_RULES = [
  {
    id: 'MCP-RPC-001', title: 'Every message is JSON-RPC 2.0', category: 'jsonrpc', severity: 'fail',
    appliesTo: RULES_ALL_VERSIONS, specRef: JSONRPC_SPEC,
    check: function (ctx) {
      if (!rulesAnswered(ctx).length) return RULES_NO_ANSWER;
      return rulesFirst(jsonrpcVersionProblems(ctx), (p) => p.problem
        ? p.probe + ': the response body is ' + p.problem
        : p.probe + ': "jsonrpc" is ' + JSON.stringify(p.jsonrpc) + ', not "2.0"');
    },
  },
  {
    id: 'MCP-RPC-002', title: 'A response carries the id of its request', category: 'jsonrpc', severity: 'fail',
    appliesTo: RULES_ALL_VERSIONS, specRef: JSONRPC_SPEC,
    check: function (ctx) {
      const responses = rulesResponses(ctx);
      if (!responses.length) return RULES_NO_ANSWER;
      return rulesFirst(responses.map(idProblem).filter(jsonrpcPresent),
        (p) => p.probe + ': response id ' + JSON.stringify(p.responseId) + ' does not match request id ' + JSON.stringify(p.requestId));
    },
  },
  {
    id: 'MCP-RPC-003', title: 'A response has a result or an error, never both; an error has a code and a message', category: 'jsonrpc', severity: 'fail',
    appliesTo: RULES_ALL_VERSIONS, specRef: JSONRPC_SPEC,
    check: function (ctx) {
      const responses = rulesResponses(ctx);
      if (!responses.length) return RULES_NO_ANSWER;
      return rulesFirst(responses.map(shapeProblem).filter(jsonrpcPresent), (p) => p.probe + ': ' + p.problem);
    },
  },
  {
    id: 'MCP-RPC-004', title: 'An unknown method is answered with error -32601', category: 'jsonrpc', severity: 'fail',
    appliesTo: RULES_ALL_VERSIONS, specRef: JSONRPC_SPEC,
    check: function (ctx) {
      const e = rulesExchange(ctx, 'unknown method');
      if (!e || e.transportError) return RULES_NO_ANSWER;
      const code = e.response && e.response.error && e.response.error.code;
      if (code === -32601) return { ok: true };
      return { ok: false, message: 'an unknown method got ' + (e.response && e.response.result ? 'a result' : 'error code ' + JSON.stringify(code)) + ', not -32601 (Method not found)',
        evidence: { status: e.status, response: e.response } };
    },
  },
];
