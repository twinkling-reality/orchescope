import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  auditCommand,
  benchmarkCommand,
  chaosCommand,
  CLI,
  compareCommand,
  goalCommand,
  goalPromptCommand,
  importTraceCommand,
  manifestCommand,
  scenarioRunCommand,
  traceCommand,
} from '../../apps/web/src/commands.ts';

/**
 * The report prints command lines a reader is meant to run. A printed invocation the binary does not accept is
 * the same defect as a button that fails when pressed, and the browser workspace cannot import the command
 * line to check itself, so the check lives here.
 *
 * Each command is verified two ways: the verb exists, and every flag it uses appears in that verb's own help.
 * Nothing is executed with real arguments, because several of these would start the audited system.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

const helpFor = async (path: readonly string[]): Promise<string> => {
  const { stdout } = await execFileAsync(process.execPath, [cliEntry, ...path, '--help'], {
    cwd: repositoryRoot,
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return stdout;
};

const flagsOf = (argv: readonly string[]): readonly string[] =>
  argv.filter((token) => token.startsWith('--') && token !== '--');

/** The verb is stated rather than parsed, and then checked against the argv the report actually prints. */
const CASES: readonly {
  readonly verb: readonly string[];
  readonly argv: readonly string[];
}[] = [
  { verb: ['audit'], argv: auditCommand() },
  { verb: ['trace'], argv: traceCommand() },
  { verb: ['trace'], argv: importTraceCommand() },
  { verb: ['test'], argv: scenarioRunCommand('support-desk') },
  { verb: ['benchmark'], argv: benchmarkCommand('support-desk') },
  { verb: ['chaos'], argv: chaosCommand('support-desk') },
  { verb: ['compare'], argv: compareCommand() },
  { verb: ['goal', 'create'], argv: goalCommand('OSC-REL-0001') },
  { verb: ['goal', 'show'], argv: goalPromptCommand('OSC-GOAL-0001') },
  { verb: ['init'], argv: manifestCommand() },
];

describe('every command the report prints', () => {
  it('is invoked as orchescope', () => {
    for (const testCase of CASES) {
      assert.equal(testCase.argv[0], CLI, `${testCase.argv.join(' ')} does not start with ${CLI}`);
    }
  });

  for (const testCase of CASES) {
    const label = testCase.argv.join(' ');
    it(`${label} names a verb the binary accepts, with flags it declares`, async () => {
      assert.deepEqual(
        testCase.argv.slice(1, 1 + testCase.verb.length),
        [...testCase.verb],
        `${label} does not begin with the verb this case claims`,
      );
      const help = await helpFor(testCase.verb);
      assert.match(
        help,
        new RegExp(`Usage: orchescope ${testCase.verb.join(' ')}`),
        `${testCase.verb.join(' ')} is not a command this binary has`,
      );
      for (const flag of flagsOf(testCase.argv)) {
        assert.ok(
          help.includes(flag),
          `${testCase.verb.join(' ')} does not declare ${flag}, so the report prints a flag it will refuse`,
        );
      }
    });
  }
});
