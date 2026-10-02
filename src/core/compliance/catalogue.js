/**
 * The full rule catalogue. Rule categories live in rules/*.js and are listed
 * here; the engine never imports a rule file directly.
 */
import { VERSION_RULES } from './rules/version.js';

export const COMPLIANCE_CATALOGUE = [].concat(VERSION_RULES);
