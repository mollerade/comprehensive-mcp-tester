/**
 * The compliance report as people read it — platform-free.
 *
 *   const summary = complianceSummary(ctx);           // what was graded, without the raw exchanges
 *   const md = complianceMarkdown(summary, report);    // for an issue, a PR or a chat
 *
 * The summary leaves the recorded exchanges out on purpose: they hold the
 * server's raw answers, and the findings already carry their evidence.
 */

const COMPLIANCE_MARK = { pass: 'pass', warn: 'WARN', fail: 'FAIL', error: 'ERROR', skipped: 'skipped', 'not-applicable': 'n/a' };
const DEFAULT_SIGN_IN_HINT = 'Sign in and run the check again to grade the rest.';

/** What a report needs to say about the run: the target, the era, and why it was only partly graded */
export function complianceSummary(ctx) {
  return {
    url: ctx.url,
    era: ctx.era || null,
    graded: !!(ctx.era || ctx.auth),
    authGraded: !!ctx.auth,
    handshakeError: ctx.handshakeError || null,
  };
}

const complianceCell = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The partial-grading line, or null when the protocol was graded */
export function complianceCaveat(summary, signInHint) {
  if (summary.era) return null;
  const why = summary.handshakeError || 'no response';
  if (summary.authGraded) return 'Only authorization was graded: the server asks for a sign-in (' + why + '). ' + (signInHint || DEFAULT_SIGN_IN_HINT);
  return 'No handshake succeeded, so the server was not graded: ' + why + '.';
}

function complianceCounts(counts) {
  return Object.keys(counts).filter((k) => counts[k]).map((k) => counts[k] + ' ' + k).join(', ');
}

/**
 * @param {object} summary  complianceSummary(ctx)
 * @param {object} report   runCompliance(...)
 * @param {object} [opts]   { signInHint } how to grade the rest, in the words of the caller (CLI, UI)
 */
export function complianceMarkdown(summary, report, opts) {
  const caveat = complianceCaveat(summary, opts && opts.signInHint);
  const lines = [
    '# MCP compliance: ' + summary.url, '',
    '- Era: ' + (summary.era || 'unknown') + ', claimed version: ' + (report.claimedVersion || 'none') +
      ', graded against ' + report.version + (report.bestEffort ? ' (best effort)' : ''),
  ];
  if (caveat) lines.push('- **' + caveat.replace(/:/, '**:'));
  lines.push('- Verdict: **' + (summary.graded ? report.verdict : 'not graded') + '** (' + complianceCounts(report.counts) + ')',
    '', '| Result | Rule | Check | Detail |', '| :--- | :--- | :--- | :--- |');
  for (const r of report.results) {
    if (r.status === 'not-applicable') continue;
    lines.push('| ' + COMPLIANCE_MARK[r.status] + ' | [' + r.id + '](' + r.specRef + ') | ' + complianceCell(r.title) + ' | ' + complianceCell(r.message) + ' |');
  }
  return lines.join('\n') + '\n';
}
