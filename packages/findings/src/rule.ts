import type { IndexedGraph } from '@orchescope/graph';
import type {
  BenchmarkReport,
  ChaosReport,
  ClaimBasis,
  ComponentId,
  ComponentRunMetrics,
  EdgeId,
  Evidence,
  EvidenceId,
  FindingCategory,
  FindingMetric,
  FindingPolarity,
  Recommendation,
  ReconciliationDelta,
  RunRecord,
  Scenario,
  Severity,
  SuggestedExperiment,
} from '@orchescope/schema';

/**
 * The rule port.
 *
 * A rule is a pure function from evidence to zero or more drafts. It cannot read a file, call a model or
 * decide its own identifier, and it must return a status even when it fires nothing, so the report can say
 * "this was checked and was clear" rather than staying silent.
 *
 * A rule that cannot decide reports `insufficient_evidence` with the reason. That is a first class outcome:
 * a tool that quietly omits what it could not establish teaches users to trust it more than they should.
 */

export type RuleStatus = 'fired' | 'clear' | 'insufficient_evidence' | 'not_applicable';

export type FindingDraft = {
  readonly ruleId: string;
  readonly category: FindingCategory;
  readonly polarity: FindingPolarity;
  /** Proposed severity. The engine lowers it when the basis or confidence does not support it. */
  readonly severity: Severity;
  readonly confidence: number;
  readonly basis: ClaimBasis;
  readonly title: string;
  readonly explanation: string;
  readonly impact: string;
  readonly components: readonly ComponentId[];
  readonly edges?: readonly EdgeId[];
  /**
   * Names the pattern this draft is one instance of.
   *
   * Two hundred instances of one pattern is one problem, not two hundred, so drafts from the same rule that
   * carry the same key become one finding with an occurrence count and the affected components. A rule that
   * reports one thing about the whole system leaves this unset and stays a finding of its own.
   *
   * `groupedTitle` is the title that finding carries, with `{count}` substituted. The rule owns the wording
   * because only the rule knows what its instances are: components, relations or cycles.
   */
  readonly occurrence?: { readonly key: string; readonly groupedTitle: string };
  /** Evidence records created by this rule. The engine stores them and rewrites the references. */
  readonly newEvidence?: readonly Evidence[];
  readonly evidence: readonly EvidenceId[];
  readonly metrics?: readonly FindingMetric[];
  readonly recommendation?: Recommendation;
  readonly suggestedExperiment?: SuggestedExperiment;
  readonly taxonomy?: readonly string[];
  readonly goalEligible: boolean;
  readonly goalReason: string;
  readonly requiresRuntimeEvidence?: boolean;
  readonly requiresHumanReview?: boolean;
  readonly tags?: readonly string[];
};

export type RuleOutcome = {
  readonly status: RuleStatus;
  readonly detail?: string;
  readonly drafts: readonly FindingDraft[];
};

export type RunEvidence = {
  readonly run: RunRecord;
  readonly componentMetrics: readonly ComponentRunMetrics[];
};

export type RuleContext = {
  readonly graph: IndexedGraph;
  readonly delta: ReconciliationDelta | undefined;
  /**
   * Runs that produced at least one span. These are the only runs a runtime claim may rest on.
   *
   * The field is named for what it carries rather than for where it came from, because the shorter
   * name invited the mistake this product exists to avoid: a rule that guarded on `runs.length === 0`
   * read as careful and was not, since a run that exported nothing still counted. Nine rules changed
   * their answer on a run containing no span, and one of them told a reader that six tools which
   * provably executed had never been exercised.
   */
  readonly observedRuns: readonly RunEvidence[];
  /**
   * Runs that were recorded and produced no span.
   *
   * They are evidence of an attempt to measure and of nothing else, so no rule may derive an absence
   * from them. They are carried rather than discarded because a reader who has just run `trace` needs
   * to be told that the run landed and the instrumentation did not, which is a different sentence
   * from never having run anything.
   */
  readonly silentRuns: readonly RunRecord[];
  readonly benchmarks: readonly BenchmarkReport[];
  readonly chaosReports: readonly ChaosReport[];
  readonly scenarios: readonly Scenario[];
  /** Evidence already in the store, so a rule can cite discovery evidence rather than duplicating it. */
  readonly evidenceById: ReadonlyMap<string, Evidence>;
};

export type Rule = {
  readonly id: string;
  readonly category: FindingCategory;
  readonly summary: string;
  readonly evaluate: (context: RuleContext) => RuleOutcome;
};

export const clear = (detail?: string): RuleOutcome => ({
  status: 'clear',
  drafts: [],
  ...(detail === undefined ? {} : { detail }),
});

export const notApplicable = (detail: string): RuleOutcome => ({
  status: 'not_applicable',
  drafts: [],
  detail,
});

export const insufficient = (detail: string): RuleOutcome => ({
  status: 'insufficient_evidence',
  drafts: [],
  detail,
});

export const fired = (drafts: readonly FindingDraft[], detail?: string): RuleOutcome =>
  drafts.length === 0
    ? clear(detail)
    : { status: 'fired', drafts, ...(detail === undefined ? {} : { detail }) };
