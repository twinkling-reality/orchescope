import { existsSync, writeFileSync } from 'node:fs';
import { RESULT_SOURCES, SCENARIO_PERMISSIONS, SCHEMA_VERSIONS } from '@orchescope/schema';
import type { WorkspacePaths } from './paths.ts';

/**
 * The scenario template.
 *
 * A scenario is the one place a repository states how its system is started: an argv executed without a
 * shell, the directory and environment it runs in, how it reports its own outcome, and the ceiling that
 * stops it. Until one exists the loop can only ask a person for that command, because nothing Orchescope
 * reads declares it and inventing one would mean executing a guess.
 *
 * Writing a template is what turns that permanent question into a one time answer. Every measurement after
 * it, the rerun, the comparison and the verdict, runs from the file rather than from a person at a keyboard.
 *
 * **It is written under `.orchescope` and it is not loaded from there.** Scenarios are read from
 * `scenarios/` at the repository root, and everything Orchescope writes goes under `.orchescope` so that
 * the footprint stays one directory and removing it is the whole cleanup. Those two facts together are why
 * the template lands beside the manifest and the command that wrote it says where to move it. The upside is
 * that the template can be a complete scenario the parser accepts rather than a commented sketch: it cannot
 * run, cannot be counted, and cannot make a repository look as though it has a scenario it does not have.
 *
 * The vocabulary comes from the schema rather than from prose, so the template cannot drift away from what
 * the validator accepts.
 */

const commented = (heading: string, values: readonly string[]): string =>
  `# ${heading}: ${values.join(', ')}`;

export const scenarioTemplate = (): string =>
  [
    '# Orchescope scenario.',
    '#',
    '# One repeatable run of your system. `target.command` is the argv Orchescope executes, without a shell,',
    '# so no shell metacharacters apply and no quoting is needed. Everything else bounds that run or judges',
    '# it: the evaluators decide whether it passed, the budgets cap what it may spend, and `expect` states the',
    '# external effects that must and must not happen.',
    '#',
    '# Fill in target.command, then move this file to scenarios/ and run:',
    '#   orchescope test --scenario example',
    '#',
    '# It is read from scenarios/ and not from here, so nothing runs until you move it.',
    '#',
    commented('result sources', RESULT_SOURCES),
    commented('permissions', SCENARIO_PERMISSIONS),
    '#',
    '# resultSource says how the target reports its own outcome. `result_file` means it writes JSON to the',
    '# path Orchescope passes in ORCHESCOPE_RESULT_FILE; `root_span` means it annotates its root span with',
    '# orchescope.task.* attributes; `exit_code` means its status is the whole answer.',
    '',
    `schemaVersion: ${SCHEMA_VERSIONS.scenario}`,
    '',
    'id: example',
    'name: One run of the system',
    'description: >',
    '  Replace this with what the run is meant to exercise, in enough detail that somebody reading a',
    '  comparison months from now knows what was being compared.',
    '',
    'target:',
    '  # The command that starts your system. Orchescope never guesses this.',
    "  command: ['node', 'src/main.js']",
    '  resultSource: exit_code',
    '  timeoutMs: 60000',
    '  stopSignal: SIGTERM',
    '  # cwd: packages/agent',
    '  # env:',
    '  #   LOG_LEVEL: error',
    '',
    '# What the run is asked to do, when your target reads it.',
    '# input:',
    '#   prompt: Where is my order 1234?',
    '',
    '# External effects the run must and must not produce, judged against what the spans reported.',
    '# expect:',
    '#   taskSuccess: true',
    '#   requiredEffects:',
    '#     - kind: notification',
    '#       minCount: 1',
    '#   prohibitedEffects:',
    '#     - kind: refund',
    '#       maxCount: 1',
    '',
    'evaluators:',
    '  - kind: exit_code',
    '    equals: 0',
    '  # - kind: output_contains_all',
    "  #   values: ['Done']",
    '  # - kind: no_duplicate_effects',
    '',
    'budgets:',
    '  maxDurationMs: 60000',
    '  maxTokens: 200000',
    '  maxModelCalls: 200',
    '  maxRetries: 20',
    '',
    '# Faults injected into the run, for orchescope chaos. None by default.',
    'faults: []',
    '',
    '# A seed makes the run repeatable, and repetitions give a metric its sample size.',
    'seed: 1',
    'repetitions: 3',
    '',
    '# What the run is allowed to do. An operation the list does not grant is refused by name.',
    'requiredPermissions:',
    '  - process:spawn',
    '',
    'tags: []',
    '',
    'metadata: {}',
    '',
  ].join('\n');

export type ScenarioTemplateResult = {
  readonly created: boolean;
  readonly scenarioFile: string;
};

/** Writes the template unless one is already there, so a filled in answer is never overwritten. */
export const writeScenarioTemplate = (paths: WorkspacePaths): ScenarioTemplateResult => {
  if (existsSync(paths.scenarioTemplateFile)) {
    return { created: false, scenarioFile: paths.scenarioTemplateFile };
  }
  writeFileSync(paths.scenarioTemplateFile, scenarioTemplate(), { mode: 0o600 });
  return { created: true, scenarioFile: paths.scenarioTemplateFile };
};
