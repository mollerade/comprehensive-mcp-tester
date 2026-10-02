/**
 * Which URLs the proxy may reach — platform-agnostic.
 *
 * The proxy runs where its users can't: on a public Worker, or inside a
 * company network on someone's laptop. Without a policy it is a fetch relay
 * to whatever an MCP server, an authorization server's metadata or a redirect
 * names, including loopback, private networks and cloud metadata endpoints.
 *
 * Policy (one list, set by the operator):
 *   []           nothing listed: public targets only on the local server; the Worker refuses all (see allowAnyPublic)
 *   ['*']        any public target
 *   ['a.com', 'http://127.0.0.1:8788']
 *                only these hosts (any port) or exact origins
 *
 * Special-purpose addresses (loopback, private, link-local, CGNAT, multicast,
 * documentation, IPv4 carried in IPv6, ...) are refused unless their host or
 * exact origin is listed, so an internal MCP server can still be tested on
 * purpose. Only http and https are ever allowed.
 *
 * This module checks the URL as parsed. The URL parser has already turned
 * 2130706433, 0x7f.1, 017700000001 and 127.1 into 127.0.0.1, so the checks
 * see the address the network stack will use. Names are checked here only
 * when they are loopback by definition (localhost); the Node host also checks
 * the addresses a name resolves to, at connect time.
 */

/** err.code a host's fetch uses when it refuses a connection on policy grounds (see hosts/guarded-fetch.js) */
export const REFUSED_CODE = 'MCP_TESTER_TARGET_REFUSED';

/** "a.com, http://b:1" → ['a.com', 'http://b:1']; empty/undefined → [] */
export function parseTargetList(str) {
  return String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

/** Lower-case origin of a listed entry, or null when it is a bare host */
function entryOrigin(entry) {
  if (entry.indexOf('://') === -1) return null;
  try { return new URL(entry).origin; } catch { return null; }
}

/** True when the list names this URL's host or its exact origin (never via '*') */
export function isListed(url, list) {
  var host = url.hostname.toLowerCase();
  for (var i = 0; i < list.length; i++) {
    var entry = list[i].toLowerCase();
    if (entry === '*') continue;
    var origin = entryOrigin(entry);
    if (origin ? origin === url.origin : entry === host) return true;
  }
  return false;
}

// ── IPv4 ──
// [first address, prefix length]; IANA special-purpose registry plus multicast and reserved
var V4_RESERVED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** '10.1.2.3' → 32-bit unsigned number, or null when not a dotted quad */
export function parseIPv4(s) {
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  var n = 0;
  for (var i = 1; i <= 4; i++) {
    var b = Number(m[i]);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

function v4InRange(n, base, bits) {
  var size = Math.pow(2, 32 - bits);
  var start = parseIPv4(base);
  return n >= start && n < start + size;
}

export function isReservedIPv4(n) {
  for (var i = 0; i < V4_RESERVED.length; i++) {
    if (v4InRange(n, V4_RESERVED[i][0], V4_RESERVED[i][1])) return true;
  }
  return false;
}

// ── IPv6 ──
/** '[::ffff:7f00:1]' or '::1' → array of 8 16-bit numbers, or null */
export function parseIPv6(s) {
  s = String(s).replace(/^\[|\]$/g, '').toLowerCase();
  var zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (s.indexOf(':') === -1) return null;
  s = dottedTailToHex(s);
  if (s === null) return null;
  var hextets = expandIPv6(s);
  if (!hextets) return null;
  var out = [];
  for (var i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(hextets[i])) return null;
    out.push(parseInt(hextets[i], 16));
  }
  return out;
}

/** A trailing dotted quad (::ffff:1.2.3.4) becomes two hextets; null when the quad is invalid */
function dottedTailToHex(s) {
  var tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (!tail) return s;
  var v4 = parseIPv4(tail[1]);
  if (v4 === null) return null;
  return s.slice(0, -tail[1].length) + Math.floor(v4 / 65536).toString(16) + ':' + (v4 % 65536).toString(16);
}

/** 'a::b' → 8 hextet strings, or null when '::' is misused or the count is wrong */
function expandIPv6(s) {
  var halves = s.split('::');
  if (halves.length > 2) return null;
  var head = halves[0] ? halves[0].split(':') : [];
  var rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  var missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return head.concat(new Array(halves.length === 2 ? missing : 0).fill('0'), rest);
}

/**
 * Only global unicast (2000::/3) is public, minus the special blocks inside
 * it. Everything outside — ::1, ::, IPv4-mapped and -compatible, NAT64
 * (64:ff9b::/96, 64:ff9b:1::/48), ULA fc00::/7, link-local fe80::/10,
 * site-local, multicast, discard 100::/64 — is reserved.
 */
export function isReservedIPv6(h) {
  if ((h[0] & 0xe000) !== 0x2000) return true;
  if (h[0] === 0x2001 && h[1] < 0x0200) return true;          // 2001::/23 IETF protocol assignments (Teredo, ORCHID, ...)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;        // 2001:db8::/32 documentation
  if (h[0] === 0x3fff && h[1] < 0x1000) return true;          // 3fff::/20 documentation
  if (h[0] === 0x2002) return isReservedIPv4(h[1] * 65536 + h[2]);   // 6to4 carries an IPv4 address
  return false;
}

/** Why this host is special-purpose, or null for a public host or a name */
export function reservedReason(hostname) {
  var host = String(hostname).toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || /\.localhost$/.test(host)) return 'a loopback name';
  var v4 = parseIPv4(host);
  if (v4 !== null) return isReservedIPv4(v4) ? 'a special-purpose IPv4 address' : null;
  var v6 = parseIPv6(host);
  if (v6) return isReservedIPv6(v6) ? 'a special-purpose IPv6 address' : null;
  return null;
}

/** For an address the resolver returned (no brackets): is it special-purpose? */
export function isReservedAddress(address) {
  var v4 = parseIPv4(address);
  if (v4 !== null) return isReservedIPv4(v4);
  var v6 = parseIPv6(address);
  return v6 ? isReservedIPv6(v6) : true;     // unparseable: refuse
}

function urlProblem(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Only http and https targets are allowed (got ' + url.protocol + ')' };
  }
  if (url.username || url.password) return { error: 'Target URLs may not carry a user name or password' };
  return null;
}

/**
 * @param {URL} url
 * @param {object} policy
 * @param {string[]} policy.allow          the operator's list (see top of file)
 * @param {boolean} policy.allowAnyPublic  what an empty list means: true on the local server, false on the Worker
 * @returns {null|{error: string, hint?: string}} null when the target may be fetched
 */
export function checkTarget(url, policy) {
  var allow = policy.allow || [];
  var basic = urlProblem(url);
  if (basic) return basic;
  var listed = isListed(url, allow);
  var reserved = reservedReason(url.hostname);
  if (reserved && !listed) {
    return {
      error: url.hostname + ' is ' + reserved + ', which this proxy does not reach unless it is listed',
      hint: 'To test it on purpose, add ' + url.origin + ' to MCP_TESTER_ALLOWED_TARGETS.',
    };
  }
  if (listed || allow.indexOf('*') !== -1 || (allow.length === 0 && policy.allowAnyPublic)) return null;
  if (allow.length === 0) {
    return {
      error: 'No targets are allowed yet',
      hint: 'Set MCP_TESTER_ALLOWED_TARGETS to the MCP and authorization server hosts, or to * for any public host.',
    };
  }
  return { error: 'Target not in allowlist: ' + url.hostname, allowed: allow };
}
