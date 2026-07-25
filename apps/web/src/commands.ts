/**
 * The only strings in this page that name a command line invocation.
 *
 * Everything else the reader sees comes from the bundle. These exist because an empty runtime section
 * has to tell the reader what would fill it, and the bundle of a report with no runs cannot contain
 * that instruction. Arguments are taken from the bundle wherever the bundle has them.
 */

export const CLI = 'orchescope';

export function scanCommand(): readonly string[] {
  return [CLI, 'scan'];
}

export function reportCommand(): readonly string[] {
  return [CLI, 'report'];
}

export function traceCommand(): readonly string[] {
  return [CLI, 'run', '--', '<your agent entrypoint>'];
}

export function scenarioRunCommand(scenarioId: string | null): readonly string[] {
  return [CLI, 'scenario', 'run', scenarioId ?? '<scenario id>'];
}

export function benchmarkCommand(scenarioId: string | null): readonly string[] {
  return [CLI, 'benchmark', scenarioId ?? '<scenario id>'];
}

export function chaosCommand(scenarioId: string | null): readonly string[] {
  return [CLI, 'chaos', scenarioId ?? '<scenario id>'];
}

export function compareCommand(): readonly string[] {
  return [CLI, 'compare', '--baseline', '<run id>', '--candidate', '<run id>'];
}

export function goalCommand(findingId: string | null): readonly string[] {
  return [CLI, 'goal', 'create', findingId ?? '<finding id>'];
}
