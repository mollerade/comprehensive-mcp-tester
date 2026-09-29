# Security policy

## Reporting a vulnerability

Please report security problems privately, never in a public issue or pull request.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/sebastienrousseau/comprehensive-mcp-tester/security/advisories/new)). Only the maintainers can see the report.

Please include what an attacker can do, the steps to reproduce it (a mock server scenario is ideal), and which host is affected: the Cloudflare Worker, the local Node server, or both.

No response time is promised yet: this is a small project maintained in spare time. You will get an acknowledgement when a maintainer has read the report, and a fix will be coordinated with you before anything is disclosed.

## Supported versions

Only the latest code on the default branch is supported. There are no maintained release branches.

## What the project defends against

The threat model, in short (the full list is in the [README's Security section](README.md#security)):

- **The local server is not an open proxy.** It binds to loopback, rejects unknown `Host` headers (DNS rebinding), rejects `/proxy` calls from other origins, and requires `Content-Type: application/json`, so no web page you visit can use it to reach internal systems.
- **The Cloudflare Worker is public** but cannot be driven by other web pages: `/proxy` rejects foreign origins and sends no CORS grants. It should sit behind Cloudflare Access before it is used with credentials.
- **Credentials stay in memory**, are bound to the server they were set up for, and are redacted from the Log.
- **OAuth checks are enforced:** issuer match, the `iss` in the authorization response, `state`, PKCE S256, and an https authorization endpoint.

A way around any of these is a vulnerability.
