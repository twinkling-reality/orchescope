import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as commands from '../../packages/report/src/commands.ts';
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
  scenarioRepeatCommand,
  scenarioRunCommand,
  traceCommand,
} from '../../packages/report/src/commands.ts';

/**
 * The terminal document prints command lines a reader (or agent) is meant to run. A printed invocation the
 * binary does not accept is the same defect as a broken tool schema.
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

/**
 * The verb is stated rather than parsed, and then checked against the argv the report actually prints.
 *
 * `builder` names the exported function each case stands for, so the list below can be held against the
 * module's own exports. It was a hand written list and it missed one: `scenarioRepeatCommand` printed
 * `--repeat` where the binary declares `--repetitions`, so the loop's own next action aborted, and this
 * suite passed because the builder that produced it was never in the list. A check that has to be
 * remembered is a check that eventually is not.
 */
const CASES: readonly {
  readonly verb: readonly string[];
  readonly argv: readonly string[];
  readonly builder: (...args: never[]) => readonly string[];
}[] = [
  { verb: ['audit'], argv: auditCommand(), builder: auditCommand },
  { verb: ['trace'], argv: traceCommand(), builder: traceCommand },
  { verb: ['trace'], argv: importTraceCommand(), builder: importTraceCommand },
  { verb: ['test'], argv: scenarioRunCommand('support-desk'), builder: scenarioRunCommand },
  {
    verb: ['test'],
    argv: scenarioRepeatCommand('support-desk', 5),
    builder: scenarioRepeatCommand,
  },
  { verb: ['benchmark'], argv: benchmarkCommand('support-desk'), builder: benchmarkCommand },
  { verb: ['chaos'], argv: chaosCommand('support-desk'), builder: chaosCommand },
  { verb: ['compare'], argv: compareCommand(), builder: compareCommand },
  { verb: ['goal', 'create'], argv: goalCommand('OSC-REL-0001'), builder: goalCommand },
  { verb: ['goal', 'show'], argv: goalPromptCommand('OSC-GOAL-0001'), builder: goalPromptCommand },
  { verb: ['init'], argv: manifestCommand(), builder: manifestCommand },
];

describe('every command the report prints', () => {
  /*
   * The list above is held against the module rather than trusted. Anything exported from `commands.ts`
   * that builds an argv is a command this product will print at somebody, so a builder with no case here
   * is a command nothing checks.
   */
  it('covers every command builder the module exports', () => {
    const exported = Object.entries(commands)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    const covered = [...new Set(CASES.map((testCase) => testCase.builder.name))].sort();
    assert.deepEqual(
      covered,
      exported,
      'a command builder is exported with no case checking it against the binary',
    );
  });

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
