/**
 * Command lines the product prints as the next action.
 *
 * Kept beside `loopProgress` and `resolveNextAction` so a printed invocation and the agent payload
 * share one argv source. The e2e suite checks each of these against the binary's own help.
 */

export const CLI = 'orchescope';

export const auditCommand = (): readonly string[] => [CLI, 'audit'];

export const traceCommand = (): readonly string[] => [
  CLI,
  'trace',
  '--',
  '<the command that starts your system>',
];

export const importTraceCommand = (): readonly string[] => [
  CLI,
  'trace',
  '--import',
  '<spans.json>',
];

export const scenarioRunCommand = (scenario: string): readonly string[] => [
  CLI,
  'test',
  '--scenario',
  scenario,
];

/**
 * The rerun the loop asks for when a comparison came back undecided, which is a sample size problem.
 *
 * The flag is `--repetitions`, which is what `orchescope test` declares. It read `--repeat` here, and
 * commander refuses an option it does not know, so the one line the loop prints at its least decided
 * moment was a line that aborts. That is worse than a command which under-records: an operator following
 * it gets an error about the tool rather than more evidence about their system.
 */
export const scenarioRepeatCommand = (scenario: string, repeat: number): readonly string[] => [
  CLI,
  'test',
  '--scenario',
  scenario,
  '--repetitions',
  String(repeat),
];

export const benchmarkCommand = (scenario: string): readonly string[] => [
  CLI,
  'benchmark',
  '--scenario',
  scenario,
  '--agents',
  '1,2,4',
];

export const chaosCommand = (scenario: string): readonly string[] => [
  CLI,
  'chaos',
  '--scenario',
  scenario,
];

export const compareCommand = (): readonly string[] => [
  CLI,
  'compare',
  '<baseline run id>',
  '<candidate run id>',
];

export const goalCommand = (findingId: string): readonly string[] => [
  CLI,
  'goal',
  'create',
  findingId,
];

export const goalPromptCommand = (goalId: string): readonly string[] => [
  CLI,
  'goal',
  'show',
  goalId,
  '--prompt',
];

export const manifestCommand = (): readonly string[] => [CLI, 'init', '--manifest'];
