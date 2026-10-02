/**
 * Authorization discovery for the compliance check — platform-free. Given the
 * 401 (or 403) a server answered, it follows the steps a client takes before
 * signing in, and records what it found:
 *
 *   WWW-Authenticate challenge → protected resource metadata (the challenge's
 *   resource_metadata URL, then the path-inserted and root well-known URLs,
 *   RFC 9728) → authorization server metadata (RFC 8414 and OpenID Connect
 *   discovery, in the spec's priority order).
 *
 * It never signs in, registers or asks for a token, and it sends none of the
 * extra headers the check was given: these are public documents.
 */

/** 'Bearer resource_metadata="…", scope="a b"' → { scheme, params } (lower-case keys), or null */
export function parseAuthChallenge(header) {
  if (!header) return null;
  const m = /(?:^|,)\s*Bearer\b/i.exec(header);
  const scheme = m ? 'Bearer' : String(header).split(/[\s,]/)[0];
  const rest = m ? header.slice(m.index + m[0].length) : '';
  const params = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let p;
  while ((p = re.exec(rest))) {
    const key = p[1].toLowerCase();
    if (!(key in params)) params[key] = p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3];
  }
  return { scheme, params };
}

/** RFC 9728 §3.1: the path-inserted well-known URL, then the root one */
export function protectedResourceUrls(serverUrl) {
  const u = new URL(serverUrl), path = u.pathname.replace(/\/$/, ''), list = [];
  if (path) list.push(u.origin + '/.well-known/oauth-protected-resource' + path);
  list.push(u.origin + '/.well-known/oauth-protected-resource');
  return list;
}

/** RFC 8414 and OpenID Connect discovery, in the MCP spec's priority order */
export function authServerMetadataUrls(issuer) {
  const u = new URL(issuer), o = u.origin, path = u.pathname.replace(/\/$/, '');
  if (path) {
    return [o + '/.well-known/oauth-authorization-server' + path, o + '/.well-known/openid-configuration' + path,
      o + path + '/.well-known/openid-configuration'];
  }
  return [o + '/.well-known/oauth-authorization-server', o + '/.well-known/openid-configuration'];
}

/** RFC 8707: no fragment, and no trailing slash on a bare origin */
export function canonicalResourceUrl(url) {
  const u = new URL(url);
  return u.protocol + '//' + u.host + (u.pathname === '/' ? '' : u.pathname) + u.search;
}

const authIsDoc = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** GET one metadata document: { url, status, doc } (doc only for a 2xx JSON object), or { url, error } */
async function authFetch(send, url) {
  let r;
  try { r = await send(url, { method: 'GET', headers: { accept: 'application/json' }, purpose: 'oauth' }); }
  catch (e) { r = { error: (e && e.message) || String(e) }; }
  return authAttempt(url, r);
}

/** What one GET found: the error, or the status and (for a 2xx JSON object) the document */
function authAttempt(url, r) {
  if (!r || r.error || !r.status) return { url, error: (r && r.error) || 'no response' };
  return { url, status: r.status, doc: r.status >= 200 && r.status < 300 ? authJsonObject(r.body) : null };
}

/** The body as a JSON object, or null */
function authJsonObject(body) {
  try {
    const doc = JSON.parse(body);
    return authIsDoc(doc) ? doc : null;
  } catch { return null; }
}

/** The first of urls that serves a JSON object, with every attempt */
async function authFirstDoc(send, urls) {
  const attempts = [];
  for (const url of urls) {
    const a = await authFetch(send, url);
    attempts.push(a);
    if (a.doc) return { attempts, found: a };
  }
  return { attempts, found: null };
}

function authPrmCandidates(serverUrl, hint) {
  const list = [];
  if (hint) { try { list.push(new URL(hint, serverUrl).href); } catch { /* not a URL: the rule reports it */ } }
  for (const u of protectedResourceUrls(serverUrl)) if (list.indexOf(u) === -1) list.push(u);
  return list;
}

/** The first authorization server the metadata names, if it is a URL */
function authIssuerOf(prm) {
  const list = prm.found && prm.found.doc.authorization_servers;
  const first = Array.isArray(list) ? list[0] : undefined;
  if (typeof first !== 'string') return null;
  try { new URL(first); } catch { return null; }
  return first;
}

/**
 * Follow discovery from a challenge.
 * challenge: the recorded exchange that was answered 401/403 ({ status, headers }).
 * Resolves { resource, challenge: { status, header, scheme, params }, prm, issuer, as }
 * where prm and as are { attempts, found } (as is null when no issuer was found).
 */
export async function collectAuth(send, serverUrl, challenge) {
  const header = (challenge.headers || {})['www-authenticate'] || null;
  const parsed = parseAuthChallenge(header) || { scheme: null, params: {} };
  const prm = await authFirstDoc(send, authPrmCandidates(serverUrl, parsed.params.resource_metadata));
  const issuer = authIssuerOf(prm);
  const as = issuer ? await authFirstDoc(send, authServerMetadataUrls(issuer)) : null;
  return {
    resource: canonicalResourceUrl(serverUrl),
    challenge: { status: challenge.status, header, scheme: parsed.scheme, params: parsed.params },
    prm, issuer, as,
  };
}
