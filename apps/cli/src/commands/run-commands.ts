import { parseDimensionValues } from '@orchescope/benchmark';
import { OrchescopeError, stableJson } from '@orchescope/domain';
import type { BenchmarkReport, ChaosReport } from '@orchescope/schema';
import {
  compareUseCase,
  importTrace,
  loadScenario,
  receiveTraces,
  runBenchmarkUseCase,
  runChaosUseCase,
  runScenarioUseCase,
  runTrace,
  type TraceResult,
} from '@orchescope/usecases';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';
import { comparisonSummary, noSpansLines, scenarioSummary } from '../terminal/summary.ts';

/**
 * Commands that execute the audited system: trace, test, benchmark, chaos and compare.
 *
 * Each one prints what it measured and, when the measurement does not support a conclusion, says so rather than
 * rounding up to a claim.
 */

const writeTraceResult = (context: CommandContext, result: TraceResult): number => {
  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'trace',
        version: context.version,
        data: {
          runId: result.run.id,
          status: result.run.status,
          spanCount: result.spanCount,
          services: result.serviceNames,
          metrics: result.run.metrics,
          exitCode: result.exitCode,
          targetResultProblem: result.targetResultProblem,
          receiverUrl: result.receiverUrl,
          otlpVariables: result.otlpVariables,
        },
      })}\n`,
    );
  } else {
    context.stdout(`\n${context.style.bold('Run')} ${result.run.id}\n`);
    context.stdout(
      `  ${result.spanCount} span(s) from ${result.serviceNames.length || 0} service(s), status ${result.run.status}\n`,
    );
    if (result.spanCount === 0) {
      context.stdout(`${noSpansLines(context.style, result)}\n`);
    }
    if (result.targetResultProblem !== undefined) {
      context.stdout(`${context.style.warn('!')} ${result.targetResultProblem}\n`);
    }
    context.stdout(
      context.style.dim(
        `next: ${result.spanCount === 0 ? 'instrument the target, or declare it in .orchescope/manifest.yaml, then run orchescope audit' : 'orchescope audit --open'}\n`,
      ),
    );
  }
  return result.run.status === 'completed' ? EXIT_CODES.success : EXIT_CODES.target;
};

export const traceCommand = async (
  context: CommandContext,
  command: readonly string[],
  options: { readonly label?: string; readonly timeout?: string; readonly import?: string },
): Promise<number> => {
  if (options.import !== undefined) {
    if (command.length > 0) {
      throw new OrchescopeError(
        'INVALID_ARGUMENT',
        'Importing spans and running a command are different operations.',
        { remediation: 'Pass either --import <file> or a command after a double dash, not both.' },
      );
    }
    return writeTraceResult(
      context,
      importTrace({
        workspace: context.workspace,
        file: options.import,
        orchescopeVersion: context.version,
        ...(options.label === undefined ? {} : { label: options.label }),
      }),
    );
  }
  if (command.length === 0) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'There is nothing to run.', {
      remediation:
        'Pass the command after a double dash, for example: orchescope trace -- npm run agent',
    });
  }
  const result = await runTrace({
    workspace: context.workspace,
    command,
    orchescopeVersion: context.version,
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.timeout === undefined ? {} : { timeoutMs: Number.parseInt(options.timeout, 10) }),
    onStdout: (chunk) => {
      if (!context.json && !context.quiet) context.stdout(chunk);
    },
    onStderr: (chunk) => {
      if (!context.json && !context.quiet) context.stderr(chunk);
    },
  });

  return writeTraceResult(context, result);
};

/**
 * A duration a person would type. Bare digits mean seconds, because that is what a reader who omitted the unit meant.
 */
const DURATION = /^(\d+)(ms|s|m|h)?$/;
const UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

export const parseDuration = (value: string): number => {
  const match = DURATION.exec(value.trim());
  const amount = match?.[1];
  if (amount === undefined) {
    throw new OrchescopeError('INVALID_ARGUMENT', `${value} is not a duration.`, {
      remediation: 'Use a number with an optional unit, for example 90s, 10m or 1h.',
    });
  }
  return Number.parseInt(amount, 10) * (UNIT_MS[match?.[2] ?? 's'] ?? 1_000);
};

/**
 * Listens for spans from a system Orchescope did not start.
 *
 * The endpoint is printed the moment it is listening, because the operator has to paste it into something else
 * before anything can arrive, and a command that prints only at the end would be useless for that.
 */
export const receiveCommand = async (
  context: CommandContext,
  options: { readonly for: string; readonly label?: string },
): Promise<number> => {
  const durationMs = parseDuration(options.for);
  const result = await receiveTraces({
    workspace: context.workspace,
    orchescopeVersion: context.version,
    durationMs,
    ...(options.label === undefined ? {} : { label: options.label }),
    onListening: ({ url, variables }) => {
      if (context.json || context.quiet) return;
      context.stdout(`\n${context.style.bold('Listening')} on ${url} for ${options.for}\n`);
      context.stdout(`  Point your system at it and rerun it:\n    ${variables}\n`);
      context.stdout(
        context.style.dim('  It accepts OTLP over HTTP on /v1/traces, protobuf or JSON.\n'),
      );
    },
    until: interrupted(),
  });
  return writeTraceResult(context, result);
};

/** Resolves when the operator interrupts, so a window can be ended early without losing what arrived. */
const interrupted = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      resolve();
    };
    process.once('SIGINT', stop);
  });

export const testCommand = async (
  context: CommandContext,
  options: { readonly scenario?: string; readonly repetitions?: string; readonly goal?: string },
): Promise<number> => {
  const reference =
    options.scenario ??
    (options.goal === undefined
      ? undefined
      : context.workspace.store.goalById(options.goal)?.validation.scenarioIds[0]);
  if (reference === undefined) {
    context.stderr(
      `${context.style.bad('error')} pass --scenario <id or path>, or --goal <goal id> for a goal that names one\n`,
    );
    return EXIT_CODES.user;
  }
  const scenario = loadScenario({ workspace: context.workspace, reference });
  const outcome = await runScenarioUseCase({
    workspace: context.workspace,
    scenario,
    orchescopeVersion: context.version,
    ...(options.repetitions === undefined
      ? {}
      : { repetitions: Number.parseInt(options.repetitions, 10) }),
  });

  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'test',
        version: context.version,
        data: { result: outcome.result, runIds: outcome.runIds },
      })}\n`,
    );
  } else {
    context.stdout(`${scenarioSummary(context.style, outcome.result)}\n`);
  }
  return outcome.result.passed ? EXIT_CODES.success : EXIT_CODES.findings;
};

export const benchmarkCommand = async (
  context: CommandContext,
  options: {
    readonly scenario?: string;
    readonly agents?: string;
    readonly workers?: string;
    readonly concurrency?: string;
    readonly repetitions?: string;
    readonly warmup?: string;
  },
): Promise<number> => {
  if (options.scenario === undefined) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'This command needs a scenario.', {
      remediation: 'Pass --scenario <id or path>, or list what exists with: orchescope test --list',
    });
  }
  const dimensions = [
    options.agents === undefined ? undefined : ('agent_count' as const),
    options.workers === undefined ? undefined : ('worker_count' as const),
    options.concurrency === undefined ? undefined : ('traffic_concurrency' as const),
  ].filter(
    (value): value is 'agent_count' | 'worker_count' | 'traffic_concurrency' => value !== undefined,
  );
  if (dimensions.length !== 1) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'A benchmark varies exactly one dimension, because varying two at once produces a number that cannot be attributed to either.',
      { remediation: 'Pass one of --agents, --workers or --concurrency.' },
    );
  }
  const dimension = dimensions[0] as 'agent_count' | 'worker_count' | 'traffic_concurrency';
  const raw = options.agents ?? options.workers ?? options.concurrency ?? '';
  const values = parseDimensionValues(raw);

  const scenario = loadScenario({ workspace: context.workspace, reference: options.scenario });
  const report = await runBenchmarkUseCase({
    workspace: context.workspace,
    scenario,
    dimension,
    values,
    repetitions: options.repetitions === undefined ? 3 : Number.parseInt(options.repetitions, 10),
    warmupRuns: options.warmup === undefined ? 0 : Number.parseInt(options.warmup, 10),
    orchescopeVersion: context.version,
  });

  if (context.json) {
    context.stdout(
      `${stableJson({ ok: true, command: 'benchmark', version: context.version, data: report })}\n`,
    );
    return EXIT_CODES.success;
  }

  writeBenchmarkText(context, report, dimension);
  return EXIT_CODES.success;
};

const writeBenchmarkText = (
  context: CommandContext,
  report: BenchmarkReport,
  dimension: string,
): void => {
  context.stdout(
    `\n${context.style.bold(`Benchmark ${report.id}`)} ${context.style.dim(dimension)}\n`,
  );
  context.stdout(
    context.style.dim(
      `  ${report.environment.cpuCount} cores, ${report.environment.platform} ${report.environment.arch}, node ${report.environment.runtimeVersion}, load ${report.environment.loadAverage1m ?? 0}\n`,
    ),
  );
  for (const variant of report.variants) {
    const label =
      variant.variant.agents ??
      variant.variant.workers ??
      variant.variant.concurrency ??
      variant.variantId;
    const p50 = variant.durationMs.p50;
    const success = variant.successRate;
    context.stdout(
      `  ${context.style.bold(String(label).padEnd(6))} p50 ${p50 === undefined ? 'withheld' : `${Math.round(p50)}ms`}  success ${success === undefined ? 'unknown' : `${Math.round(success * 100)}%`}  tokens ${variant.aggregateMetrics.inputTokens + variant.aggregateMetrics.outputTokens}  runs ${variant.completedRuns}/${variant.repetitions}\n`,
    );
  }
  for (const limitation of report.limitations) {
    context.stdout(context.style.dim(`  . ${limitation}\n`));
  }
};

/**
 * A fault that the system absorbed is not the same as one it survived by accident. A completed task with a duplicated
 * effect is marked as a warning rather than a success, because the effect is the thing that reached the outside world.
 */
const chaosMarker = (context: CommandContext, outcome: ChaosReport['outcomes'][number]): string => {
  if (!outcome.taskCompleted) return context.style.bad('x');
  return outcome.duplicateSideEffects > 0 ? context.style.warn('!') : context.style.good('+');
};

const writeChaosText = (context: CommandContext, report: ChaosReport): void => {
  context.stdout(
    `\n${context.style.bold(`Chaos ${report.id}`)} ${context.style.dim(report.environment)}\n`,
  );
  for (const outcome of report.outcomes) {
    context.stdout(
      `  ${chaosMarker(context, outcome)} ${outcome.faultKind} on ${outcome.target}: completed ${outcome.taskCompleted}, recovered ${outcome.recovered}, duplicates ${outcome.duplicateSideEffects}, cost x${(outcome.costAmplification ?? 1).toFixed(2)}\n`,
    );
  }
  for (const entry of report.notApplied) {
    context.stdout(
      context.style.dim(
        `  - ${entry.faultKind} on ${entry.target} was not applied: ${entry.reason}\n`,
      ),
    );
  }
};

export const chaosCommand = async (
  context: CommandContext,
  options: {
    readonly scenario?: string;
    readonly seed?: string;
    readonly repetitions?: string;
    readonly environment?: string;
  },
): Promise<number> => {
  if (options.scenario === undefined) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'This command needs a scenario.', {
      remediation: 'Pass --scenario <id or path>, or list what exists with: orchescope test --list',
    });
  }
  const scenario = loadScenario({ workspace: context.workspace, reference: options.scenario });
  if (scenario.faults.length === 0) {
    context.stderr(
      `${context.style.bad('error')} scenario ${scenario.id} declares no faults, so there is nothing to inject\n`,
    );
    return EXIT_CODES.user;
  }
  const report = await runChaosUseCase({
    workspace: context.workspace,
    scenario,
    orchescopeVersion: context.version,
    ...(options.seed === undefined ? {} : { seed: Number.parseInt(options.seed, 10) }),
    ...(options.repetitions === undefined
      ? {}
      : { repetitions: Number.parseInt(options.repetitions, 10) }),
    ...(options.environment === 'declared_test' || options.environment === 'live'
      ? { environment: options.environment }
      : {}),
  });

  if (context.json) {
    context.stdout(
      `${stableJson({ ok: true, command: 'chaos', version: context.version, data: report })}\n`,
    );
    return EXIT_CODES.success;
  }

  writeChaosText(context, report);
  return report.outcomes.some(
    (outcome) => !outcome.taskCompleted || outcome.duplicateSideEffects > 0,
  )
    ? EXIT_CODES.findings
    : EXIT_CODES.success;
};

export const compareCommand = (
  context: CommandContext,
  baseline: string,
  candidate: string,
  options: { readonly goal?: string },
): number => {
  const comparison = compareUseCase({
    workspace: context.workspace,
    baseline,
    candidate,
    ...(options.goal === undefined ? {} : { goalId: options.goal }),
  });
  if (context.json) {
    context.stdout(
      `${stableJson({ ok: true, command: 'compare', version: context.version, data: comparison })}\n`,
    );
  } else {
    context.stdout(`${comparisonSummary(context.style, comparison)}\n`);
  }
  return comparison.verdict === 'regressed' ? EXIT_CODES.findings : EXIT_CODES.success;
};
