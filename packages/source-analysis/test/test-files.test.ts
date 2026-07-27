import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTestFile } from '../src/test-files.ts';

/**
 * The two directions matter equally here. Reading a test as production maps a repository's fakes and misses the
 * system behind them, and reading production as a test drops the system on the floor. Both cases are asserted, and
 * the second list is the one that keeps the convention from widening into a guess.
 */

describe('a path that names a test', () => {
  const tests = [
    'packages/worker/test/helpers/d1.ts',
    'packages/web/src/lib/api.test.js',
    'src/__tests__/router.tsx',
    'src/__mocks__/fetch.ts',
    'tests/integration/queue.spec.ts',
    'apps/api/testing/fixtures.mts',
    'service/tests/test_client.py',
    'service/conftest.py',
    'service/client_test.py',
    'src/reducer.spec.jsx',
  ];

  for (const path of tests) {
    it(`reads ${path} as a test`, () => {
      assert.equal(isTestFile(path), true);
    });
  }
});

describe('a path that does not name a test', () => {
  const sources = [
    'packages/worker/src/index.ts',
    'packages/web/src/lib/api.ts',
    'src/contest.ts',
    'src/latest.ts',
    'src/protest/handler.ts',
    // A directory of API documents is not a test harness, which is why `spec` alone never matches.
    'spec/openapi.ts',
    'src/attestation.py',
    'src/greatest.py',
  ];

  for (const path of sources) {
    it(`reads ${path} as source`, () => {
      assert.equal(isTestFile(path), false);
    });
  }
});
