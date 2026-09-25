/* ── Suggested requests ──
   Build a sample value from a JSON schema node, the way MCP Inspector
   suggests a starting request the user can edit. */
function suggestValue(s, depth) {
  depth = depth || 0;
  if (!s || depth > 4) return null;
  if (s.default !== undefined) return s.default;
  if (s.examples && s.examples.length) return s.examples[0];
  if (s.enum && s.enum.length) return s.enum[0];
  if (s.const !== undefined) return s.const;
  var t = s.type;
  if (Array.isArray(t)) t = t[0];
  if (t === 'string') {
    if (s.format === 'date-time') return new Date().toISOString();
    if (s.format === 'date') return new Date().toISOString().slice(0, 10);
    if (s.format === 'email') return 'user@example.com';
    if (s.format === 'uri' || s.format === 'url') return 'https://example.com';
    if (s.pattern) return '';
    return 'text';
  }
  if (t === 'number') return s.minimum !== undefined ? s.minimum : 1;
  if (t === 'integer') return s.minimum !== undefined ? s.minimum : 1;
  if (t === 'boolean') return false;
  if (t === 'array') {
    var iv = suggestValue(s.items, depth + 1);
    return iv === null ? [] : [iv];
  }
  if (t === 'object' || s.properties) {
    var out = {}, props = s.properties || {};
    var req = s.required || [];
    var keys = req.length ? req : Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      if (props[keys[i]]) out[keys[i]] = suggestValue(props[keys[i]], depth + 1);
    }
    return out;
  }
  return null;
}

/* Suggested arguments for a tool: all required params, plus optionals that
   declare a default / enum / example (so placeholder junk is never sent). */
function suggestArgs(schema) {
  var out = {}, props = (schema && schema.properties) || {};
  var req = (schema && schema.required) || [];
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], p = props[k];
    var isReq = req.indexOf(k) !== -1;
    var hasHint = p.default !== undefined || (p.enum && p.enum.length) || (p.examples && p.examples.length) || p.const !== undefined;
    if (isReq || hasHint) out[k] = suggestValue(p, 0);
  }
  return out;
}

/* ── Drafts: per-item editing state that survives re-renders ── */
function getDraft(key) {
  if (!state.drafts[key]) state.drafts[key] = { mode: 'form', formVals: null, jsonText: null, jsonDirty: false, lastReq: null, lastRes: undefined, lastMeta: null };
  return state.drafts[key];
}

