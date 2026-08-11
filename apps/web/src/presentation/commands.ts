/**
 * The only strings in this page that name a command line invocation.
 *
 * Everything else the reader sees comes from the bundle. These exist because an empty runtime section
 * has to tell the reader what would fill it, and the bundle of a report with no runs cannot contain
 * that instruction. Arguments are taken from the bundle wherever the bundle has them.
 *
 * Every builder here has to name a command the binary actually accepts. A report that prints an
 * invocation the reader cannot run is the same defect as a button that fails when pressed, so
 * `tests/e2e/report-commands.test.ts` runs each of these against the real command line surface.
 */

export const CLI = 'orchescope';

export function auditCommand(): readonly string[] {
  return [CLI, 'audit'];
}

export function traceCommand(): readonly string[] {
  return [CLI, 'trace', '--', '<the command that starts your system>'];
}

export function importTraceCommand(): readonly string[] {
  return [CLI, 'trace', '--import', '<spans.json>'];
}

export function scenarioRunCommand(scenarioId: string | null): readonly string[] {
  return [CLI, 'test', '--scenario', scenarioId ?? '<scenario id>'];
}

export function benchmarkCommand(scenarioId: string | null): readonly string[] {
  return [CLI, 'benchmark', '--scenario', scenarioId ?? '<scenario id>', '--agents', '1,2,4'];
}

export function chaosCommand(scenarioId: string | null): readonly string[] {
  return [CLI, 'chaos', '--scenario', scenarioId ?? '<scenario id>'];
}

export function compareCommand(): readonly string[] {
  return [CLI, 'compare', '<baseline run id>', '<candidate run id>'];
}

export function goalCommand(findingId: string | null): readonly string[] {
  return [CLI, 'goal', 'create', findingId ?? '<finding id>'];
}

export function goalPromptCommand(goalId: string | null): readonly string[] {
  return [CLI, 'goal', 'show', goalId ?? '<goal id>', '--prompt'];
}

export function manifestCommand(): readonly string[] {
  return [CLI, 'init', '--manifest'];
}
