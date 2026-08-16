import type { AuditResult } from '@orchescope/usecases';

/**
 * The smallest audit result the terminal document can be composed from.
 *
 * Every region module reads a handful of fields out of a bundle and a coverage record, so the fixture
 * states those fields and casts the rest away rather than constructing a whole report: a fixture that
 * had to be a valid report would be rewritten every time the schema grew a field, and what these tests
 * are about is which of the fields reach a line.
 */

type Coverage = AuditResult['graph']['coverage'];
type Finding = AuditResult['bundle']['findings'][number];

export const coverage = (over: Partial<Coverage> = {}): Coverage =>
  ({
    filesDiscovered: 23,
    filesInSupportedLanguages: 23,
    filesParsed: 23,
    bytesParsed: 1000,
    skipped: [],
    languages: [],
    adapters: [],
    unsupported: [],
    durationMs: 10,
    truncated: false,
    ...over,
  }) as unknown as Coverage;

export const adapter = (
  adapterId: string,
  status: 'completed' | 'not_applicable' | 'failed',
  detail?: string,
): Coverage['adapters'][number] =>
  ({
    adapterId,
    adapterVersion: '1',
    ecosystem: 'configuration',
    componentsFound: 0,
    edgesFound: 0,
    filesInspected: 0,
    durationMs: 1,
    status,
    ...(detail === undefined ? {} : { detail }),
  }) as unknown as Coverage['adapters'][number];

export const finding = (over: Partial<Finding> = {}): Finding =>
  ({
    id: 'OSC-REL-0001',
    polarity: 'risk',
    severity: 'medium',
    basis: 'discovered',
    category: 'reliability',
    confidence: 0.8,
    title: 'a model is called with no timeout declared',
    evidence: ['e1', 'e2'],
    goalReadiness: {
      eligible: true,
      reason: 'the evidence bounds a change',
      requiresRuntimeEvidence: false,
      requiresHumanReview: false,
    },
    ...over,
  }) as unknown as Finding;

/**
 * A component list whose kinds are what the headline names.
 *
 * The headline counts agents, tools and models out of the graph and falls back to the part count when
 * a project has none of the three, so a fixture has to carry components with kinds on them. Padding
 * with prompts keeps the kind counts and `componentCount` telling the same story, which is what a
 * golden of the headline is checking.
 */
const componentsOfKinds = (
  counts: Readonly<Record<string, number>>,
  total: number,
): AuditResult['graph']['components'] => {
  const named = Object.entries(counts).flatMap(([kind, count]) =>
    Array.from({ length: count }, (_value, index) => ({ id: `${kind}:${index}`, kind })),
  );
  const padding = Array.from({ length: Math.max(0, total - named.length) }, (_value, index) => ({
    id: `prompt:${index}`,
    kind: 'prompt',
  }));
  return [...named, ...padding] as unknown as AuditResult['graph']['components'];
};

export const auditResult = (over: {
  readonly projectName?: string;
  readonly componentCount?: number;
  readonly edgeCount?: number;
  readonly componentKinds?: Readonly<Record<string, number>>;
  readonly agentSystemDetected?: boolean;
  readonly coverage?: Coverage;
  readonly findings?: readonly Finding[];
  readonly reconciliation?: AuditResult['reconciliation'];
  readonly runs?: AuditResult['bundle']['runs'];
}): AuditResult => {
  /*
   * A reconciliation without a run in the bundle is a fixture that lied about its own shape: the join
   * region would render while the loop said nothing had been run. When reconciliation is present and
   * the caller did not name runs, one placeholder run keeps both regions honest.
   */
  const runs =
    over.runs ??
    (over.reconciliation === undefined
      ? []
      : ([{ id: 'run_0000000000000001' }] as unknown as AuditResult['bundle']['runs']));
  const componentCount = over.componentCount ?? 33;
  return {
    graph: {
      coverage: over.coverage ?? coverage(),
      provenance: { scanId: 'scan_0' },
      components: componentsOfKinds(
        over.componentKinds ?? { agent: 5, tool: 7, model: 2 },
        componentCount,
      ),
    },
    findingSet: { rulesEvaluated: [] },
    reconciliation: over.reconciliation,
    agentSystemDetected: over.agentSystemDetected ?? true,
    runsConsidered: [],
    scanId: 'scan_0',
    reportDigest: 'digest',
    bundle: {
      projectName: over.projectName ?? 'demo',
      summary: {
        componentCount,
        edgeCount: over.edgeCount ?? 32,
        runCount: runs.length,
        findingCountBySeverity: {},
        strengthCount: 0,
      },
      findings: over.findings ?? [],
      goals: [],
      scenarios: [],
      scenarioRuns: [],
      runs,
      componentMetrics: [],
      chaosReports: [],
      comparisons: [],
    },
  } as unknown as AuditResult;
};

export const reconciliation = (over: {
  readonly exercised?: number;
  readonly declared?: number;
  readonly notExercised?: number;
  readonly notDeclared?: number;
  readonly contradictions?: number;
  readonly duplicates?: number;
}): NonNullable<AuditResult['reconciliation']> =>
  ({
    coverage: {
      exercisedComponents: over.exercised ?? 14,
      declaredComponents: over.declared ?? 21,
    },
    declaredNotExercised: { components: Array.from({ length: over.notExercised ?? 7 }, () => 'c') },
    exercisedNotDeclared: { components: Array.from({ length: over.notDeclared ?? 1 }, () => 'c') },
    contradictions: Array.from({ length: over.contradictions ?? 0 }, () => 'x'),
    duplicateSideEffects: Array.from({ length: over.duplicates ?? 1 }, () => 'x'),
  }) as unknown as NonNullable<AuditResult['reconciliation']>;
