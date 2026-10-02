/**
 * A structural check of a JSON Schema 2020-12 document, enough to grade a tool's
 * inputSchema: keyword types are right, subschemas are schemas, and local $refs
 * resolve. It does not validate instances, and a $ref to another document is
 * reported, because a client cannot fetch it from the tool definition alone.
 */

const SCHEMA_TYPES = ['null', 'boolean', 'object', 'array', 'number', 'string', 'integer'];
const SCHEMA_ONE = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames',
  'unevaluatedItems', 'unevaluatedProperties', 'additionalItems'];
const SCHEMA_MAP = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const SCHEMA_LIST = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SCHEMA_MAX_DEPTH = 64;

const schemaIsObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** '#/$defs/a~1b' → the node it points at, or undefined */
function schemaPointer(root, ref) {
  if (ref === '#') return root;
  if (ref.indexOf('#/') !== 0) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    let part;
    try { part = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~'); } catch { return undefined; }
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

function schemaHasAnchor(node, name, depth) {
  if (!node || typeof node !== 'object' || depth > SCHEMA_MAX_DEPTH) return false;
  if (node.$anchor === name) return true;
  for (const k of Object.keys(node)) if (schemaHasAnchor(node[k], name, depth + 1)) return true;
  return false;
}

function schemaRefProblem(ref, root) {
  if (typeof ref !== 'string') return '$ref must be a string';
  if (ref.charAt(0) !== '#') return '$ref "' + ref + '" points outside the tool definition, so it cannot be resolved';
  if (/^#[A-Za-z_][-A-Za-z0-9._]*$/.test(ref)) return schemaHasAnchor(root, ref.slice(1), 0) ? null : '$ref "' + ref + '" names no $anchor';
  return schemaPointer(root, ref) === undefined ? '$ref "' + ref + '" does not resolve' : null;
}

function schemaTypeProblem(type) {
  const list = Array.isArray(type) ? type : [type];
  if (!list.length) return 'type is an empty list';
  for (const t of list) if (SCHEMA_TYPES.indexOf(t) === -1) return 'type ' + JSON.stringify(t) + ' is not a JSON Schema type';
  return new Set(list).size === list.length ? null : 'type lists a type twice';
}

function schemaRequiredProblem(req) {
  if (!Array.isArray(req) || req.some((x) => typeof x !== 'string')) return 'required must be a list of property names';
  return new Set(req).size === req.length ? null : 'required lists a property twice';
}

/** Problems in the keywords of one schema object, not its subschemas */
function schemaKeywordProblems(node, root) {
  const out = [];
  if ('type' in node) out.push(schemaTypeProblem(node.type));
  if ('required' in node) out.push(schemaRequiredProblem(node.required));
  if ('enum' in node && !Array.isArray(node.enum)) out.push('enum must be a list');
  if ('$ref' in node) out.push(schemaRefProblem(node.$ref, root));
  return out.filter((p) => p);
}

function schemaMapChildren(node, path, kids) {
  for (const k of SCHEMA_MAP) {
    if (!(k in node)) continue;
    if (!schemaIsObject(node[k])) { kids.push(path + '/' + k + ': must be an object of schemas'); continue; }
    for (const name of Object.keys(node[k])) kids.push([path + '/' + k + '/' + name, node[k][name]]);
  }
}

function schemaListChildren(node, path, kids) {
  for (const k of SCHEMA_LIST) {
    if (!(k in node)) continue;
    if (!Array.isArray(node[k]) || !node[k].length) { kids.push(path + '/' + k + ': must be a non-empty list of schemas'); continue; }
    node[k].forEach((s, i) => kids.push([path + '/' + k + '/' + i, s]));
  }
}

/** [path, subschema] for every subschema directly under this one, or a problem string */
function schemaChildren(node, path) {
  const kids = [];
  for (const k of SCHEMA_ONE) if (k in node) kids.push([path + '/' + k, node[k]]);
  schemaMapChildren(node, path, kids);
  schemaListChildren(node, path, kids);
  return kids;
}

function schemaWalk(node, path, root, depth, out) {
  if (typeof node === 'boolean') return;
  if (!schemaIsObject(node)) { out.push(path + ': a schema must be an object or a boolean'); return; }
  if (depth > SCHEMA_MAX_DEPTH) { out.push(path + ': nested too deeply'); return; }
  for (const p of schemaKeywordProblems(node, root)) out.push(path + ': ' + p);
  for (const kid of schemaChildren(node, path)) {
    if (typeof kid === 'string') out.push(kid);
    else schemaWalk(kid[1], kid[0], root, depth + 1, out);
  }
}

/** Every structural problem in a schema, as "path: problem" strings; [] when it is sound */
export function schemaProblems(schema) {
  const out = [];
  schemaWalk(schema, '#', schema, 0, out);
  return out;
}
