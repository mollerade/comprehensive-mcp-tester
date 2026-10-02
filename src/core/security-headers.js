/**
 * Content-Security-Policy for the UI page, sent by every host with the HTML.
 *
 * The page is one self-contained file with inline script and style (ADR 0002),
 * so 'unsafe-inline' is unavoidable for scripts and styles. What the policy
 * still buys, as defence in depth behind the escaping fixes:
 *   connect-src 'self'       the page may only talk to its own /proxy, so an
 *                            injected script cannot send in-memory tokens away
 *   frame-ancestors 'none'   no clickjacking by framing the tester
 *   base-uri, form-action    no rebasing relative URLs or posting forms away
 * The stylesheet imports its fonts from Google Fonts (src/ui/styles.css), so
 * those two origins are allowed for styles and fonts only.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
