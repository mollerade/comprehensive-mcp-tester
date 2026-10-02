/**
 * The first release (#80): after the bump every version reference agrees and
 * is a released version, and the release workflow reads the published release
 * back (files against SHA256SUMS, provenance, notes, tag signature).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

test('AC-REL-V001-01: versions agree', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.notEqual(version, '0.0.0', 'the release branch is not bumped yet');
  const consistent = spawnSync(process.execPath, ['scripts/check-versions.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(consistent.status, 0, consistent.stderr);
  assert.ok(consistent.stdout.includes(`versions ok (${version})`), consistent.stdout);
  const policy = spawnSync(process.execPath, ['scripts/version.mjs', 'check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(policy.status, 0, policy.stderr);
  assert.ok(read('README.md').includes(`(currently ${version})`), `README does not say "currently ${version}"`);
  assert.ok(read('CHANGELOG.md').split('\n').some((l) => l.startsWith(`## [${version}]`)), `CHANGELOG.md has a [${version}] heading`);
});

test('AC-REL-V001-02: published release reads back', () => {
  const workflow = read('.github/workflows/release.yml');
  const audit = workflow.split('- name: Audit the published release')[1];
  assert.ok(audit, 'the workflow has an audit step after publishing');
  assert.match(audit, /if: env\.DRY_RUN == 'false'/, 'the audit runs only for a real release');
  assert.match(audit, /gh release download "\$TAG"/, 'every published asset is downloaded');
  assert.match(audit, /sha256sum --check SHA256SUMS/, 'assets are checked against SHA256SUMS');
  assert.match(audit, /gh attestation verify "audit\/\$f" --repo "\$REPO"/, 'provenance is verified for each file');
  assert.match(audit, /--bundle "audit\/mcp-tester-\$VERSION\.provenance\.sigstore\.json"/, 'the shipped provenance bundle verifies offline');
  for (const section of ['## Highlights', "## What's Changed", '## Checksums', '**Full Changelog**']) {
    assert.ok(audit.includes(section), `the notes are checked for ${section}`);
  }
  assert.match(audit, /\.verification\.verified\)" = true \]/, 'the tag signature is verified by GitHub');
  const preflight = workflow.split('- name: Preflight')[1].split('- name: Version references agree')[0];
  assert.match(preflight, /"MCP Tester v\$VERSION"/, 'the tag message is checked');
  assert.match(preflight, /git merge-base --is-ancestor "\$COMMIT" origin\/main/, 'the tag must point at main');
});

test('attestations are skipped for pull requests from forks, which get no OIDC token', () => {
  const workflow = read('.github/workflows/release.yml');
  const guard = "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
  for (const step of ['Build provenance', 'SBOM attestation', 'Ship the provenance bundle with the release']) {
    const body = workflow.split('- name: ' + step)[1];
    assert.ok(body, 'the workflow has a step named ' + step);
    assert.ok(body.split('- name:')[0].includes(guard), step + ' is not guarded for fork pull requests');
  }
  const publish = workflow.split('- name: Publish the release')[1].split('- name:')[0];
  assert.match(publish, /if: env\.DRY_RUN == 'false'/, 'publishing stays a real-release step');
});

test('a dry run composes the notes around a stand-in when generate-notes is refused', () => {
  const step = read('.github/workflows/release.yml').split('- name: Release notes')[1].split('- uses:')[0];
  assert.match(step, /if ! gh api "repos\/\$REPO\/releases\/generate-notes"/, 'the API call is guarded');
  assert.match(step, /\[ "\$DRY_RUN" = true \] \|\| exit 1/, 'a real release still fails when the API does');
  assert.match(step, /\*\*Full Changelog\*\*: https:\/\/github\.com\/%s\/commits\/%s/, 'the stand-in carries the Full Changelog line the composer requires');
});
