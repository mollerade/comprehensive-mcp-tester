#!/usr/bin/env node
/**
 * The test suite as CI runs it — no dependencies, plain Node.
 *
 *   npm run test:ci                  every suite, spec output, plus reports/junit-node<major>.xml
 *   node scripts/run-ci-tests.mjs <files> the same for chosen test files (the tooling tests use this)
 *
 * REPORTS_DIR overrides the report directory. The exit code is the test run's.
 *
 * Never name a runnable script test-*.mjs, *.test.mjs or similar: a bare `node --test` treats
 * such files as tests, and this one would then start the whole suite again, without end.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './is-main.mjs';

/** Where this Node version's JUnit report goes */
export function junitPath(dir = process.env.REPORTS_DIR || 'reports') {
  return join(dir, `junit-node${process.versions.node.split('.')[0]}.xml`);
}

/** Started from inside another test run, a nested `node --test` would report to it and write no JUnit file */
function withoutTestContext(env) {
  const clean = { ...env };
  delete clean.NODE_TEST_CONTEXT;
  return clean;
}

function main(files) {
  const report = junitPath();
  mkdirSync(join(report, '..'), { recursive: true });
  const r = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', `--test-reporter-destination=${report}`,
    ...files,
  ], { stdio: 'inherit', env: withoutTestContext(process.env) });
  process.exitCode = r.status === null ? 1 : r.status;
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
