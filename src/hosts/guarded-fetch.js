/**
 * fetch for the local Node host that will not connect to special-purpose addresses.
 *
 * The proxy core checks every URL before fetching it, but it only sees names.
 * A public-looking name can resolve to 127.0.0.1 or 10.x, or resolve to a
 * public address when checked and a private one when connected (DNS
 * rebinding). So the name is resolved once, in the socket's own lookup: if
 * any answer is special-purpose the connection is refused, and the socket
 * connects only to the addresses that were checked.
 *
 * Hosts the operator listed explicitly skip the address check, so an internal
 * MCP server can be tested on purpose. Global fetch (undici) offers no lookup
 * hook without adding a dependency, hence node:http.
 *
 * Returns a standard Response with the body already read, which is all the
 * proxy core needs (status, headers, text()).
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import zlib from 'node:zlib';
import { isListed, isReservedAddress, REFUSED_CODE } from '../core/target-policy.js';

const NULL_BODY = [101, 204, 205, 304];

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: options.family || 0, hints: options.hints }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => isReservedAddress(a.address));
    if (bad) {
      const e = new Error(hostname + ' resolves to ' + bad.address + ', a special-purpose address, which this proxy does not connect to unless the host is listed');
      e.code = REFUSED_CODE;
      e.hint = 'To test it on purpose, add ' + hostname + ' to MCP_TESTER_ALLOWED_TARGETS.';
      return callback(e);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function decode(buffer, encoding) {
  switch (String(encoding || '').trim().toLowerCase()) {
    case 'gzip': case 'x-gzip': return zlib.gunzipSync(buffer);
    case 'deflate': return zlib.inflateSync(buffer);
    case 'br': return zlib.brotliDecompressSync(buffer);
    default: return buffer;
  }
}

/** @param {{allow?: string[]}} [opts] the operator's target list */
export function createGuardedFetch(opts = {}) {
  const allow = opts.allow || [];
  return function guardedFetch(input, init = {}) {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    const body = init.body == null ? null : Buffer.from(String(init.body));
    if (body) headers['content-length'] = String(body.length);
    const lib = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.request(url, {
        method,
        headers,
        signal: init.signal,
        lookup: isListed(url, allow) ? undefined : guardedLookup,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode > 599) throw new Error('Invalid HTTP status ' + res.statusCode);
            const out = new Headers();
            for (let i = 0; i < res.rawHeaders.length; i += 2) out.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
            const empty = NULL_BODY.includes(res.statusCode) || method === 'HEAD';
            const data = empty ? null : decode(Buffer.concat(chunks), res.headers['content-encoding']);
            resolve(new Response(data, { status: res.statusCode, statusText: res.statusMessage, headers: out }));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end(body || undefined);
    });
  };
}
