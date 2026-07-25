import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { runRequest } from './agents/orchestrator.ts';
import type { EffectRecord, RefundQueue, RequestContext, RunConfig, Totals } from './context.ts';
import { createFaultEngine, type FaultEngine, type FaultKind } from './faults.ts';
import { createMemory } from './memory.ts';
import { createRefundQueue } from './queue.ts';
import { createTrace, flushTelemetry } from './telemetry.ts';

/**
 * Entry point.
 *
 * Every knob is optional: with no environment variables at all this runs one request against the fixed
 * default question, offline, and prints a short summary. The variables it honours are the ones Orchescope
 * documents in `TARGET_ENV`, and anything it does not recognise is ignored rather than rejected.
 */

const DEFAULT_INPUT =
  'Order 1234 arrived two weeks late. I would like a refund, and please confirm the replacement is in stock.';
const PRIMARY_MODEL = 'demo-small';
const FALLBACK_MODEL = 'demo-large';
const DEFAULT_PROMPT_VERSION = 'v3';
const MAX_SEED = 2_147_483_647;
const MAX_RESULT_OUTPUT_CHARS = 20_000;
const MAX_RESULT_EFFECTS = 500;
const MAX_PRINTED_EFFECTS = 12;

type TargetResult = {
  readonly success: boolean;
  readonly output: string;
  readonly effects: readonly EffectRecord[];
  readonly userInterventions: number;
  readonly policyViolations: number;
  readonly loopIterations: number;
};

const flagsOf = (argv: readonly string[]): ReadonlyMap<string, string> => {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;
    const equals = token.indexOf('=');
    if (equals >= 0) {
      flags.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(token.slice(2), next);
      index += 1;
    } else {
      flags.set(token.slice(2), 'true');
    }
  }
  return flags;
};

const intOf = (raw: string | undefined, fallback: number, low: number, high: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(high, Math.max(low, Math.trunc(parsed)));
};

const configOf = (argv: readonly string[]): RunConfig => {
  const flags = flagsOf(argv);
  const read = (flag: string, variable: string): string | undefined =>
    flags.get(flag) ?? process.env[variable];
  const model = read('model', 'ORCHESCOPE_MODEL') ?? PRIMARY_MODEL;
  return {
    seed: intOf(read('seed', 'ORCHESCOPE_SEED'), 1, 0, MAX_SEED),
    agents: intOf(read('agents', 'ORCHESCOPE_AGENTS'), 3, 1, 8),
    workers: intOf(read('workers', 'ORCHESCOPE_WORKERS'), 2, 1, 4),
    concurrency: intOf(read('concurrency', 'ORCHESCOPE_CONCURRENCY'), 1, 1, 50),
    topology: read('topology', 'ORCHESCOPE_TOPOLOGY') === 'chain' ? 'chain' : 'star',
    model,
    // The fallback is the larger model. A run whose primary model already is the larger one has no fallback
    // left, which is honest: the retry simply repeats on the same model.
    fallbackModel: FALLBACK_MODEL,
    input: read('input', 'ORCHESCOPE_INPUT') ?? DEFAULT_INPUT,
    promptVersion: read('prompt-version', 'ORCHESCOPE_PROMPT_VERSION') ?? DEFAULT_PROMPT_VERSION,
  };
};

const runOne = async (
  config: RunConfig,
  faults: FaultEngine,
  queue: RefundQueue,
  totals: Totals,
  index: number,
): Promise<{ success: boolean; output: string; effects: readonly EffectRecord[] }> => {
  const trace = createTrace(config.seed, index);
  const conversationId = `conv-${config.seed}-${index + 1}`;
  const effects: EffectRecord[] = [];
  const context: RequestContext = {
    config,
    index,
    conversationId,
    trace,
    faults,
    memory: createMemory(trace, conversationId),
    queue,
    totals,
    effects,
  };
  const outcome = await runRequest(context);
  return { success: outcome.success, output: outcome.output, effects };
};

const writeResult = (result: TargetResult): void => {
  const path = process.env['ORCHESCOPE_RESULT_FILE'];
  if (path === undefined || path.length === 0) return;
  try {
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(
      `the result file could not be written: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
};

const describeEffect = (effect: EffectRecord): string => {
  const key = effect.idempotencyKey;
  return `  effect ${effect.kind} -> ${effect.target} ${effect.outcome}${
    key === undefined ? ' (no idempotency key)' : ` key=${key}`
  }`;
};

const printSummary = (
  config: RunConfig,
  result: TargetResult,
  applied: readonly FaultKind[],
): void => {
  console.log(
    `orchescope demo: ${config.concurrency} request(s), seed ${config.seed}, agents ${config.agents}, workers ${config.workers}, topology ${config.topology}, model ${config.model}`,
  );
  console.log(
    `outcome: ${result.success ? 'success' : 'failure'}, effects ${result.effects.length}, interventions ${result.userInterventions}, policy violations ${result.policyViolations}, loop iterations ${result.loopIterations}`,
  );
  if (applied.length > 0) console.log(`faults applied: ${applied.join(', ')}`);
  for (const effect of result.effects.slice(0, MAX_PRINTED_EFFECTS)) {
    console.log(describeEffect(effect));
  }
  if (result.effects.length > MAX_PRINTED_EFFECTS) {
    console.log(`  ... ${result.effects.length - MAX_PRINTED_EFFECTS} more effect(s)`);
  }
  console.log(`answer: ${result.output.slice(0, 400)}`);
};

const main = async (): Promise<void> => {
  const config = configOf(process.argv.slice(2));
  const faults = createFaultEngine();
  const refunds = createRefundQueue({ workers: config.workers, seed: config.seed, faults });
  const totals: Totals = { userInterventions: 0, policyViolations: 0, loopIterations: 0 };

  const outcomes = await Promise.all(
    Array.from({ length: config.concurrency }, (_unused, index) =>
      runOne(config, faults, refunds.queue, totals, index),
    ),
  );
  await refunds.close();
  await flushTelemetry();

  const result: TargetResult = {
    success: outcomes.every((outcome) => outcome.success),
    output: outcomes
      .map((outcome) => outcome.output)
      .join(' || ')
      .slice(0, MAX_RESULT_OUTPUT_CHARS),
    effects: outcomes.flatMap((outcome) => [...outcome.effects]).slice(0, MAX_RESULT_EFFECTS),
    userInterventions: totals.userInterventions,
    policyViolations: totals.policyViolations,
    loopIterations: totals.loopIterations,
  };
  writeResult(result);
  printSummary(config, result, faults.appliedKinds());
};

try {
  await main();
} catch (error) {
  console.error(`the demo run failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
