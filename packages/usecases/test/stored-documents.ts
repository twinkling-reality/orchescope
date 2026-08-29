import type {
  Distribution,
  Finding,
  Goal,
  RepetitionResult,
  RunEnvironment,
  RunMetrics,
  RunRecord,
  Scenario,
  ScenarioResult,
  VariantResult,
} from '@orchescope/schema';

/**
 * The documents a test puts in the store double, built rather than cast.
 *
 * A fixture used to be an object literal with `as unknown as RunRecord` after it, which is a promise the
 * compiler is told to stop checking. What that produced was a `RunRecord` carrying an identifier, a status
 * and a `metrics` object with one of its twenty one fields, handed to production code that reads the rest.
 * The code happened not to read them, and a fixture that survives only because the code has not looked at
 * it yet is not evidence of anything.
 *
 * Everything here returns a complete document with an `overrides` seam, so a test states the two or three
 * fields it is actually about and the rest are real. Nothing in this file is cast.
 */

const AT = '2026-08-01T00:00:00.000Z';

/** A run identifier is `run_` and sixteen hex, so a fixture cannot invent `run_a1` and still be one. */
export const runId = (ordinal: number): string => `run_${ordinal.toString(16).padStart(16, '0')}`;

export const scenarioResultId = (ordinal: number): string =>
  `sres_${ordinal.toString(16).padStart(16, '0')}`;

export const environment = (): RunEnvironment => ({
  orchescopeVersion: '0.9.2',
  platform: 'darwin',
  arch: 'arm64',
  cpuCount: 8,
  totalMemoryBytes: 17_179_869_184,
  runtimeName: 'node',
  runtimeVersion: 'v24.0.0',
});

export const metrics = (overrides: Partial<RunMetrics> = {}): RunMetrics => ({
  durationMs: 200,
  taskSuccess: true,
  modelCalls: 2,
  toolCalls: 2,
  agentSteps: 1,
  handoffs: 0,
  retrievalCalls: 0,
  memoryOperations: 0,
  inputTokens: 100,
  outputTokens: 50,
  errors: 0,
  retries: 0,
  recoveredErrors: 0,
  duplicateSideEffects: 0,
  prohibitedSideEffects: 0,
  sideEffects: 1,
  userInterventions: 0,
  policyViolations: 0,
  maxObservedConcurrency: 1,
  loopIterations: 1,
  ...overrides,
});

export const runRecord = (overrides: Partial<RunRecord> & Pick<RunRecord, 'id'>): RunRecord => ({
  kind: 'scenario',
  label: overrides.id,
  status: 'completed',
  startedAt: AT,
  finishedAt: AT,
  environment: environment(),
  metrics: metrics(),
  componentMetrics: [],
  metadata: {},
  ...overrides,
});

const distribution = (value: number): Distribution => ({
  sampleSize: 1,
  mean: value,
  min: value,
  max: value,
  stdDev: 0,
  withheld: [],
  values: [value],
});

const variantResult = (runIds: readonly string[]): VariantResult => ({
  variantId: 'default',
  variant: {},
  runIds: [...runIds],
  repetitions: runIds.length,
  completedRuns: runIds.length,
  failedRuns: 0,
  successRate: 1,
  durationMs: distribution(200),
  totalTokens: distribution(150),
  modelCalls: distribution(2),
  toolCalls: distribution(2),
  retries: distribution(0),
  aggregateMetrics: metrics(),
  evaluators: [],
});

const repetitionResult = (id: string, index: number): RepetitionResult => ({
  runId: id,
  repetition: index,
  status: 'completed',
  taskSuccess: true,
  metrics: metrics(),
  evaluators: [],
  sideEffects: [],
  duplicateSideEffectKeys: [],
  prohibitedSideEffectKinds: [],
  faultsApplied: [],
});

export const scenarioResult = (input: {
  readonly id: string;
  readonly scenarioId: string;
  readonly runIds: readonly string[];
  readonly startedAt?: string;
  readonly passed?: boolean;
}): ScenarioResult => ({
  schemaVersion: 1,
  id: input.id,
  scenarioId: input.scenarioId,
  scenarioVersion: 1,
  startedAt: input.startedAt ?? AT,
  finishedAt: input.startedAt ?? AT,
  environment: environment(),
  repetitions: input.runIds.map((id, index) => repetitionResult(id, index)),
  aggregate: variantResult(input.runIds),
  reliability: {
    repetitions: input.runIds.length,
    successes: input.runIds.length,
    successRate: 1,
    passPowerK: [],
  },
  passed: input.passed ?? true,
  limitations: [],
  metadata: {},
});

export const scenario = (overrides: Partial<Scenario> & Pick<Scenario, 'id'>): Scenario => ({
  schemaVersion: 1,
  name: 'One run of the system',
  target: { command: ['node', 'main.js'], resultSource: 'exit_code', timeoutMs: 30_000 },
  evaluators: [{ kind: 'exit_code', equals: 0 }],
  budgets: {},
  faults: [],
  requiredPermissions: ['process:spawn'],
  tags: [],
  metadata: {},
  ...overrides,
});

export const finding = (overrides: Partial<Finding> & Pick<Finding, 'id'>): Finding => ({
  ruleId: 'independent-calls-run-sequentially',
  category: 'performance',
  polarity: 'risk',
  severity: 'high',
  confidence: 0.9,
  basis: 'observed',
  title: 'Independent calls run one after another',
  explanation: 'The orchestrator awaits each call in turn.',
  impact: 'The task takes longer than the work requires.',
  components: [],
  edges: [],
  sourceLocations: [],
  evidence: [],
  metrics: [],
  goalReadiness: {
    eligible: true,
    reason: 'The change is local to one call site and is verified by comparing runs.',
    requiresRuntimeEvidence: false,
    requiresHumanReview: false,
  },
  taxonomy: [],
  conflictsWith: [],
  tags: [],
  createdAt: AT,
  metadata: {},
  ...overrides,
});

export const goal = (overrides: Partial<Goal> & Pick<Goal, 'id' | 'findingId'>): Goal => ({
  schemaVersion: 1,
  title: 'Make the independent calls overlap',
  status: 'ready',
  createdAt: AT,
  updatedAt: AT,
  problemStatement: 'Two independent lookups are awaited one after the other.',
  evidence: ['ev_0000000000000000'],
  evidenceSummary: [],
  affectedComponents: ['agent:orchestrator'],
  sourceLocations: [],
  scope: {
    allowedWritePaths: ['src/'],
    prohibitedChanges: [],
    invariants: [],
    requiredApprovals: [],
  },
  risk: 'low',
  acceptanceCriteria: [
    {
      id: 'AC-01',
      statement: 'the finding no longer fires on a rescan',
      check: { kind: 'finding_resolved', findingId: overrides.findingId },
    },
  ],
  validation: {
    commands: [],
    baselineRunIds: [],
    scenarioIds: [],
    repetitions: 3,
    requiresExecution: false,
  },
  rollback: 'Revert the commit.',
  validationResults: [],
  reviews: [],
  metadata: {},
  ...overrides,
});
