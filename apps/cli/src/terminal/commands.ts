/**
 * Command lines the terminal document (and agents reading its text) are meant to run.
 *
 * Kept beside the TUI so a printed invocation can be checked against the binary without a second
 * product surface inventing its own argv.
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
