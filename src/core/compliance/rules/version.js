/**
 * Protocol version rules. `KNOWN_PROTOCOL_VERSIONS` is every revision the
 * catalogue knows how to grade; 2025-11-25 and earlier use the initialize
 * handshake, 2026-07-28 is stateless.
 */
export const KNOWN_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];

export const VERSION_RULES = [
  {
    id: 'MCP-VER-001',
    title: 'The claimed protocol version is a published revision',
    category: 'version',
    severity: 'warn',
    appliesTo: KNOWN_PROTOCOL_VERSIONS,
    specRef: 'https://modelcontextprotocol.io/specification/versioning',
    check: function (ctx) {
      if (KNOWN_PROTOCOL_VERSIONS.indexOf(ctx.claimedVersion) !== -1) return { ok: true };
      if (ctx.handshakeError) return { skip: 'no handshake succeeded, so no version was claimed' };
      return { ok: false, message: 'unknown protocol version: ' + (ctx.claimedVersion || '(none claimed)') };
    },
  },
];
