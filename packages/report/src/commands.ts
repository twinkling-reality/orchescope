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

export const scenarioRepeatCommand = (scenario: string, repeat: number): readonly string[] => [
  CLI,
  'test',
  '--scenario',
  scenario,
  '--repeat',
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
