import {
  assertNoViolations,
  capSeverity,
  compareSeverity,
  dedupeEvidence,
  findingViolations,
  findingId as makeFindingId,
} from '@orchescope/domain';
import type { IndexedGraph } from '@orchescope/graph';
import type {
  Evidence,
  EvidenceId,
  Finding,
  FindingCategory,
  FindingSet,
  Timestamp,
} from '@orchescope/schema';
import { groupDrafts } from './grouping.ts';
import type { FindingDraft, Rule, RuleContext, RuleStatus } from './rule.ts';
import { EXPERIMENT_RULES } from './rules/experiments.ts';
import { RECONCILIATION_RULES } from './rules/reconciliation.ts';
import { RUNTIME_RULES } from './rules/runtime.ts';
import { STATIC_RULES } from './rules/static-policy.ts';

/**
 * The finding engine.
 *
 * Its job is everything a rule is not allowed to do: assign stable identifiers, lower a severity the
 * evidence does not support, record which rules were evaluated including the ones that found nothing, and
 * refuse to emit a finding that violates a domain invariant.
 *
 * Identifier assignment is deterministic. Drafts are ordered by rule identifier and then by the components
 * they name, so the same evidence produces the same finding identifiers on every machine, which is what
 * makes a goal that references OSC-PERF-0001 mean the same thing tomorrow.
 */

export const DEFAULT_RULES: readonly Rule[] = [
  ...RECONCILIATION_RULES,
  ...STATIC_RULES,
  ...RUNTIME_RULES,
  ...EXPERIMENT_RULES,
];

export type EngineResult = {
  readonly findingSet: FindingSet;
  readonly evidence: readonly Evidence[];
};

/** A grouped finding names many components, and a location list has to stay something a person can read. */
const MAX_SOURCE_LOCATIONS = 10;

const draftOrder = (left: FindingDraft, right: FindingDraft): number => {
  if (left.ruleId !== right.ruleId) return left.ruleId < right.ruleId ? -1 : 1;
  const leftKey = [...left.components].sort().join(',');
  const rightKey = [...right.components].sort().join(',');
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  return left.title < right.title ? -1 : left.title > right.title ? 1 : 0;
};

export type EvaluateInput = {
  readonly scanId: string;
  readonly generatedAt: Timestamp;
  readonly graph: IndexedGraph;
  readonly context: Omit<RuleContext, 'graph'>;
  readonly rules?: readonly Rule[];
};

type EvaluatedRule = {
  ruleId: string;
  category: FindingCategory;
  status: RuleStatus;
  detail?: string;
};

/** Runs every rule and collects what each one produced, including the ones that produced nothing. */
const collectDrafts = (
  rules: readonly Rule[],
  context: RuleContext,
): {
  readonly evaluated: EvaluatedRule[];
  readonly drafts: FindingDraft[];
  readonly newEvidence: Evidence[];
} => {
  const evaluated: EvaluatedRule[] = [];
  const drafts: FindingDraft[] = [];
  const newEvidence: Evidence[] = [];

  for (const rule of rules) {
    const outcome = rule.evaluate(context);
    evaluated.push({
      ruleId: rule.id,
      category: rule.category,
      status: outcome.status,
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
    });
    for (const draft of outcome.drafts) {
      drafts.push(draft);
      newEvidence.push(...(draft.newEvidence ?? []));
    }
  }
  return { evaluated, drafts, newEvidence };
};

/**
 * One draft becomes one finding.
 *
 * Severity is capped by what the basis and the confidence can support, so a rule cannot report a critical risk from an
 * inference. A strength is always informational: a good design is not a severity.
 */
const toFinding = (
  draft: FindingDraft,
  input: EvaluateInput,
  sequence: number,
  componentIds: ReadonlySet<string>,
  evidenceIds: readonly EvidenceId[],
): Finding => {
  const capped = capSeverity(draft.severity, draft.basis, draft.confidence);
  return {
    id: makeFindingId(draft.category, sequence),
    ruleId: draft.ruleId,
    category: draft.category,
    polarity: draft.polarity,
    severity: draft.polarity === 'strength' ? 'info' : capped.severity,
    confidence: draft.confidence,
    basis: draft.basis,
    title: draft.title,
    explanation: draft.explanation,
    impact: draft.impact,
    components: draft.components.filter((id) => componentIds.has(id)),
    edges: [...(draft.edges ?? [])],
    sourceLocations: draft.components
      .map((id) => input.graph.component(id))
      .flatMap((component) => component?.sourceLocations.slice(0, 2) ?? [])
      .slice(0, MAX_SOURCE_LOCATIONS),
    evidence: [...evidenceIds],
    metrics: [...(draft.metrics ?? [])],
    ...(draft.recommendation === undefined ? {} : { recommendation: draft.recommendation }),
    ...(draft.suggestedExperiment === undefined
      ? {}
      : { suggestedExperiment: draft.suggestedExperiment }),
    goalReadiness: {
      eligible: draft.goalEligible,
      reason: draft.goalReason,
      requiresRuntimeEvidence: draft.requiresRuntimeEvidence ?? false,
      requiresHumanReview: draft.requiresHumanReview ?? false,
    },
    taxonomy: [...(draft.taxonomy ?? [])],
    conflictsWith: [],
    tags: [...(draft.tags ?? []), ...(capped.capReason === undefined ? [] : ['severity-capped'])],
    createdAt: input.generatedAt,
    metadata: capped.capReason === undefined ? {} : { severityCapReason: capped.capReason },
  };
};

/** How many components a finding touches, which is the closest thing to blast radius the graph carries. */
const blastRadius = (finding: Finding): number => {
  const occurrences = finding.metrics.find((metric) => metric.name === 'occurrences')?.value ?? 1;
  const withheld =
    finding.metrics.find((metric) => metric.name === 'componentsWithheld')?.value ?? 0;
  return Math.max(occurrences, finding.components.length + withheld);
};

/**
 * The order a person should read them in: worst first, then what can actually be acted on, then how much of the
 * system it touches. A low finding that repeats two hundred times must not sit above a high one, and between two
 * findings of the same severity the one that can become a bounded goal is the one worth reading first.
 */
const byWhatToReadFirst = (left: Finding, right: Finding): number => {
  const bySeverity = compareSeverity(left.severity, right.severity);
  if (bySeverity !== 0) return bySeverity;
  if (left.polarity !== right.polarity) return left.polarity === 'risk' ? -1 : 1;
  if (left.goalReadiness.eligible !== right.goalReadiness.eligible) {
    return left.goalReadiness.eligible ? -1 : 1;
  }
  const byRadius = blastRadius(right) - blastRadius(left);
  if (byRadius !== 0) return byRadius;
  return left.id < right.id ? -1 : 1;
};

export const evaluateRules = (input: EvaluateInput): EngineResult => {
  const context: RuleContext = { ...input.context, graph: input.graph };
  const collected = collectDrafts(input.rules ?? DEFAULT_RULES, context);
  const evaluated = collected.evaluated;
  const drafts = groupDrafts([...collected.drafts].sort(draftOrder));

  const sequences = new Map<FindingCategory, number>();
  const componentIds = new Set(input.graph.graph.components.map((component) => component.id));
  const findings: Finding[] = [];

  for (const draft of drafts) {
    const evidenceIds = [
      ...new Set([...(draft.newEvidence ?? []).map((record) => record.id), ...draft.evidence]),
    ] as EvidenceId[];

    if (evidenceIds.length === 0) {
      // A finding with no evidence is not reportable. Recording the drop keeps the omission visible.
      evaluated.push({
        ruleId: draft.ruleId,
        category: draft.category,
        status: 'insufficient_evidence',
        detail: `a draft titled "${draft.title}" was dropped because it carried no evidence`,
      });
      continue;
    }

    const sequence = (sequences.get(draft.category) ?? 0) + 1;
    sequences.set(draft.category, sequence);
    findings.push(toFinding(draft, input, sequence, componentIds, evidenceIds));
  }

  findings.sort(byWhatToReadFirst);

  assertNoViolations(
    findings.flatMap((finding) => findingViolations(finding, componentIds)),
    'Finding generation',
  );

  return {
    findingSet: {
      schemaVersion: 1,
      scanId: input.scanId,
      generatedAt: input.generatedAt,
      findings,
      rulesEvaluated: evaluated,
    },
    evidence: dedupeEvidence(collected.newEvidence),
  };
};
