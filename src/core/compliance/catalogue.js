/**
 * The full rule catalogue. Rule categories live in rules/*.js and are listed
 * here; the engine never imports a rule file directly.
 */
import { VERSION_RULES } from './rules/version.js';
import { JSONRPC_RULES } from './rules/jsonrpc.js';
import { TRANSPORT_RULES } from './rules/transport.js';
import { LIFECYCLE_RULES } from './rules/lifecycle.js';
import { RESULT_RULES } from './rules/results.js';
import { TOOL_RULES } from './rules/tools.js';
import { RESOURCE_RULES } from './rules/resources.js';
import { AUTH_RULES } from './rules/auth.js';

export const COMPLIANCE_CATALOGUE = [].concat(VERSION_RULES, JSONRPC_RULES, TRANSPORT_RULES, LIFECYCLE_RULES, RESULT_RULES, TOOL_RULES, RESOURCE_RULES, AUTH_RULES);
