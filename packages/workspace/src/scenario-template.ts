import { existsSync, writeFileSync } from 'node:fs';
import { RESULT_SOURCES, SCENARIO_PERMISSIONS, SCHEMA_VERSIONS } from '@orchescope/schema';
import type { WorkspacePaths } from './paths.ts';
import {
  type ComposedScenario,
  composeScenario,
  EMPTY_COMPOSITION,
  type ScenarioNeed,
} from './scenario-composition.ts';
import { type StartCommandCandidate, startCommandCandidates } from './start-command-candidates.ts';

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

/**
 * Commands the repository already declares, offered beside the placeholder and never in place of it.
 *
 * The placeholder is the honest answer where nothing is known, and it stays the value the parser reads.
 * These sit above it as comments with the file and line each was read from, so filling the field in is a
 * choice a reader makes from their own repository rather than a command this build picked for them.
 *
 * **The property that decides is stated with them.** A `start` script is often a server that never exits,
 * and offering one without saying what happens to it is offering a command that always fails. Choosing a
 * different evaluator does not rescue it: `repetitionStatus` returns `timeout` before any evaluator is
 * consulted and a repetition that is not `completed` fails whatever its evaluators say, so the refusal is
 * about the target rather than about the check. Nothing this build reads says which of these exits on its
 * own, so none of them is picked, and the one question that separates them is asked here rather than
 * guessed at.
 */
const candidateLines = (candidates: readonly StartCommandCandidate[]): readonly string[] =>
  candidates.length === 0
    ? []
    : [
        '  # Declared in this repository, read and not run. Pick one, or write your own:',
        ...candidates.map(
          (candidate) => `  #   ${candidate.command}    (${candidate.file}:${candidate.line})`,
        ),
        '  #',
        '  # Does the one you pick exit on its own? A target that does not is stopped at target.timeoutMs',
        '  # and recorded as a timeout. A repetition that did not complete fails whatever its evaluators say,',
        '  # so no evaluator here rescues a server. It needs a command that finishes instead.',
      ];

/**
 * The expectation block, live where a requirement asked for one and an example otherwise.
 *
 * The commented form stays where nothing asked, because a reader with no findings still has to be shown
 * the shape, and a live block naming an effect nobody asked about would be an assertion this build made up.
 */
const expectLines = (composed: ComposedScenario): readonly string[] =>
  composed.expect.length > 0
    ? [...composed.expect]
    : [
        '# expect:',
        '#   taskSuccess: true',
        '#   requiredEffects:',
        '#     - kind: notification',
        '#       minCount: 1',
        '#   prohibitedEffects:',
        '#     - kind: refund',
        '#       maxCount: 1',
      ];

/**
 * The exit code check the template has always written, and the evaluators a requirement asked for.
 *
 * The exit code entry stays even though `repetitionStatus` already fails a non zero exit, because a
 * scenario declaring no evaluator at all passes vacuously, and a template that ships one deciding nothing
 * is worse than one shipping a check that agrees with the status.
 */
const evaluatorLines = (composed: ComposedScenario): readonly string[] => [
  'evaluators:',
  '  - kind: exit_code',
  '    equals: 0',
  ...composed.evaluators,
  ...(composed.evaluators.length > 0
    ? []
    : [
        '  # - kind: output_contains_all',
        "  #   values: ['Done']",
        '  # - kind: no_duplicate_effects',
      ]),
];

const faultLines = (composed: ComposedScenario): readonly string[] =>
  composed.faults.length === 0
    ? ['# Faults injected into the run, for orchescope chaos. None by default.', 'faults: []']
    : ['faults:', ...composed.faults];

export const scenarioTemplate = (
  candidates: readonly StartCommandCandidate[] = [],
  needs: readonly ScenarioNeed[] = [],
): string => {
  const composed = needs.length === 0 ? EMPTY_COMPOSITION : composeScenario(needs);
  return [
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
    ...(composed.notes.length === 0 ? [] : [...composed.notes, '#']),
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
    ...candidateLines(candidates),
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
    ...expectLines(composed),
    '',
    ...evaluatorLines(composed),
    '',
    'budgets:',
    '  maxDurationMs: 60000',
    '  maxTokens: 200000',
    '  maxModelCalls: 200',
    '  maxRetries: 20',
    '',
    ...faultLines(composed),
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
};

export type ScenarioTemplateResult = {
  readonly created: boolean;
  readonly scenarioFile: string;
  /** Whether a finding's own requirement was written into it, so the command can say which file it wrote. */
  readonly composed?: boolean;
};

/** Writes the template unless one is already there, so a filled in answer is never overwritten. */
export const writeScenarioTemplate = (
  paths: WorkspacePaths,
  needs: readonly ScenarioNeed[] = [],
): ScenarioTemplateResult => {
  if (existsSync(paths.scenarioTemplateFile)) {
    return { created: false, scenarioFile: paths.scenarioTemplateFile };
  }
  writeFileSync(
    paths.scenarioTemplateFile,
    scenarioTemplate(startCommandCandidates(paths.root), needs),
    { mode: 0o600 },
  );
  return { created: true, scenarioFile: paths.scenarioTemplateFile, composed: needs.length > 0 };
};
