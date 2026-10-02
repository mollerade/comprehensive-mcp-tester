// Two AC-tagged failures and an untagged one, for scripts/ci-summary.mjs. The names are
// built at run time so the traceability check does not read them as real criteria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const ac = (...parts) => ['AC', ...parts].join('-');
test(ac('X', '01') + ': a', () => assert.fail('boom'));
test(ac('Y', '03') + ': b | with a pipe', () => assert.fail('boom'));
test('an untagged failure', () => assert.fail('boom'));
test('a pass', () => {});
