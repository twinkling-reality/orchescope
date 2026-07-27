/**
 * Whether a path is a test file, by the naming conventions the three supported ecosystems share.
 *
 * A test harness reaches the same clients the system reaches, and it reaches them at fakes. A scan of one repository
 * mapped a `sqlite` database whose every source location was a double: a `FakeD1` class over `node:sqlite` in
 * `test/helpers`, and the shims two port scripts declare. The repository's real database, a Cloudflare D1 binding
 * used by fifty seven prepared statements across twenty four modules, was not in the graph at all. The graph named
 * the harness and missed the system.
 *
 * That matters beyond tidiness, because the join this product exists for compares what a repository declares against
 * what a run exercises. A component that only a test constructs can never appear in a production run, so carrying it
 * into the graph manufactures an unexercised declaration for every one of them.
 *
 * This reads a path and nothing else. It cannot see a test written somewhere no convention names, and it is not a
 * judgement about whether the file is worth reading: analysis still parses it and other readers still use it.
 */

const TEST_DIRECTORIES = new Set(['test', 'tests', '__tests__', '__mocks__', 'testing']);

/**
 * `spec` is deliberately absent. A directory of that name holds OpenAPI and schema documents at least as often as it
 * holds tests, and reading a repository's API specification as its test harness is the more expensive mistake.
 */
const TEST_FILE_PATTERN = /(^|[.\-_])(test|spec)s?\.[cm]?[jt]sx?$/i;
const PYTHON_TEST_PATTERN = /(^test_.*|.*_test)\.py$/i;

export const isTestFile = (path: string): boolean => {
  const segments = path.split('/');
  const name = segments.at(-1) ?? '';
  if (segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment.toLowerCase())))
    return true;
  if (name.toLowerCase() === 'conftest.py') return true;
  if (PYTHON_TEST_PATTERN.test(name)) return true;
  return TEST_FILE_PATTERN.test(name);
};
