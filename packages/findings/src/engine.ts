import {
  assertNoFindingIdentityCollisions,
  assertNoViolations,
  basisIsSupportable,
  capSeverity,
  compareSeverity,
  dedupeEvidence,
  findingViolations,
  findingIdentity,
  type FindingIdentity,
  type FindingIdentityAssignment,
  type FindingSemanticSubject,
  SEMANTIC_FINDING_IDENTITY,
} from '@orchescope/domain';
import type { IndexedGraph } from '@orchescope/graph';
import { sourceLocationKey } from '@orchescope/graph';
import type {
  Evidence,
  EvidenceId,
  Finding,
  FindingCategory,
  FindingSet,
  SourceLocation,
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
 * Identifier assignment and display order are separate. A rule-defined semantic key assigns identity;
 * severity, goal readiness and blast radius decide where the finding is displayed.
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

/**
 * One entry per place, however many components were minted there.
 *
 * A finding names the components it is about, and two of them are often the same line: discovery mints a
 * frame to hold an effect and the service the effect reaches at the same call, so both carry it. Listing
 * it twice reads as two call sites, and worse, the repeats are counted against the ceiling: nine entries
 * for seven places and ten for eight, with the places past the tenth entry dropped to make room for
 * duplicates of the ones already shown.
 */
const distinctLocations = (locations: readonly SourceLocation[]): readonly SourceLocation[] => {
  const seen = new Map<string, SourceLocation>();
  for (const location of locations) {
    const key = sourceLocationKey(location);
    if (!seen.has(key)) seen.set(key, location);
  }
  return [...seen.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, location]) => location);
};

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
  identity: FindingIdentity,
  componentIds: ReadonlySet<string>,
  evidenceIds: readonly EvidenceId[],
  sourceLocations: readonly SourceLocation[],
): Finding => {
  const capped = capSeverity(draft.severity, draft.basis, draft.confidence);
  return {
    id: identity.id,
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
    sourceLocations: distinctLocations(sourceLocations).slice(0, MAX_SOURCE_LOCATIONS),
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
    metadata: {
      findingIdentity: SEMANTIC_FINDING_IDENTITY,
      findingSemanticKey: identity.semanticKeyDigest,
      findingSemanticSubject: identity.semanticSubjectDigest,
      ...(capped.capReason === undefined ? {} : { severityCapReason: capped.capReason }),
      ...(draft.remediationVariant === undefined
        ? {}
        : { remediationVariant: draft.remediationVariant }),
    },
  };
};

const CLAIM_CLAUSES = ['mechanism', 'subject', 'conclusion'] as const;

const claimEvidenceIds = (draft: FindingDraft): readonly EvidenceId[] =>
  [
    ...new Set(CLAIM_CLAUSES.flatMap((clause) => draft.claimEvidence[clause])),
  ].sort() as EvidenceId[];

const evidenceDependencies = (record: Evidence): readonly EvidenceId[] => {
  if (record.kind === 'derived') return record.inputs;
  if (record.kind === 'model_interpretation') return record.groundedIn;
  return [];
};

const claimShapeViolation = (
  draft: FindingDraft,
  evidenceById: ReadonlyMap<string, Evidence>,
): string | undefined => {
  if (draft.claimEvidenceRefusal !== undefined) return draft.claimEvidenceRefusal;
  if ((draft.newEvidence?.length ?? 0) > 100) {
    return `draft created ${draft.newEvidence?.length ?? 0} evidence records, exceeding the 100-record claim ceiling`;
  }
  const occurrenceCount =
    draft.metrics?.find((metric) => metric.name === 'occurrences')?.value ?? 1;
  for (const clause of CLAIM_CLAUSES) {
    if (draft.claimEvidence[clause].length === 0) return `${clause} clause carried no evidence`;
    if (draft.claimEvidence[clause].length > 100) {
      return `${clause} clause carried ${draft.claimEvidence[clause].length} evidence records, exceeding the 100-record claim ceiling`;
    }
    const populationId = draft.claimPopulationEvidence?.[clause];
    if (populationId !== undefined) {
      if (!draft.claimEvidence[clause].includes(populationId)) {
        return `${clause} clause population evidence ${populationId} was not bound to the clause`;
      }
      const population = evidenceById.get(populationId);
      if (
        draft.occurrence === undefined ||
        !(
          (population?.kind === 'absence' && population.inspectedCount >= occurrenceCount) ||
          (population?.kind === 'metric' && population.sampleSize >= occurrenceCount)
        )
      ) {
        return `${clause} clause population evidence ${populationId} was not a structured inspected population`;
      }
    }
  }
  return undefined;
};

const evidenceClosure = (
  ids: readonly EvidenceId[],
  evidenceById: ReadonlyMap<string, Evidence>,
): ReadonlySet<string> => {
  const closure = new Set<string>();
  const pending = [...ids];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || closure.has(id)) continue;
    closure.add(id);
    const record = evidenceById.get(id);
    if (record !== undefined) pending.push(...evidenceDependencies(record));
  }
  return closure;
};

const incompleteResilienceOutcome = (record: Evidence): boolean =>
  record.kind === 'fault_injection' &&
  (record.taskCompleted === undefined ||
    record.recovered === undefined ||
    record.duplicateSideEffects === undefined ||
    record.prohibitedSideEffects === undefined ||
    record.userInterventions === undefined ||
    record.degradedGracefully === undefined ||
    record.policyViolations === undefined);

const transitiveEvidenceViolation = (
  draft: FindingDraft,
  evidenceById: ReadonlyMap<string, Evidence>,
): string | undefined => {
  const conclusionClosure = evidenceClosure(draft.claimEvidence.conclusion, evidenceById);
  const pending = [...claimEvidenceIds(draft)];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const record = evidenceById.get(id);
    if (record === undefined) return `evidence ${id} could not be resolved`;
    if (record.kind === 'derived' && record.inputs.length === 0) {
      return `derived evidence ${id} carried no inputs`;
    }
    if (record.kind === 'model_interpretation' && record.groundedIn.length === 0) {
      return `model interpretation evidence ${id} carried no grounding`;
    }
    if (record.kind === 'metric' && 'runIds' in record && record.runIds.length > 100) {
      return `metric evidence ${id} exceeded the 100-run population ceiling`;
    }
    if (
      draft.polarity === 'strength' &&
      conclusionClosure.has(id) &&
      incompleteResilienceOutcome(record)
    ) {
      return `fault injection evidence ${id} lacked the complete outcome required for a resilience strength`;
    }
    pending.push(...evidenceDependencies(record));
  }
  return undefined;
};

const evidenceViolation = (
  draft: FindingDraft,
  evidenceById: ReadonlyMap<string, Evidence>,
): string | undefined =>
  claimShapeViolation(draft, evidenceById) ?? transitiveEvidenceViolation(draft, evidenceById);

const evidenceSourceLocations = (
  ids: readonly EvidenceId[],
  evidenceById: ReadonlyMap<string, Evidence>,
): readonly SourceLocation[] => {
  const locations: SourceLocation[] = [];
  const pending = [...ids];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const record = evidenceById.get(id);
    if (record === undefined) continue;
    if (record.kind === 'source_span') locations.push(record.location);
    pending.push(...evidenceDependencies(record));
  }
  return locations;
};

const semanticSubjectFor = (draft: FindingDraft): FindingSemanticSubject => {
  if (draft.occurrence !== undefined) {
    return { kind: 'occurrence', key: draft.occurrence.key };
  }
  if (draft.wholeSystemSubject !== undefined) {
    return { kind: 'system', key: draft.wholeSystemSubject };
  }
  return {
    kind: 'entities',
    components: draft.components,
    edges: draft.edges ?? [],
  };
};

const identityFor = (draft: FindingDraft): FindingIdentity =>
  findingIdentity({
    ruleId: draft.ruleId,
    polarity: draft.polarity,
    situation: draft.situation,
    ...(draft.remediationVariant === undefined ? {} : { remediation: draft.remediationVariant }),
    subject: semanticSubjectFor(draft),
    ...(draft.identityDiscriminator === undefined
      ? {}
      : { discriminator: draft.identityDiscriminator }),
  });

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

  const componentIds = new Set(input.graph.graph.components.map((component) => component.id));
  const evidenceById = new Map(input.context.evidenceById);
  for (const record of collected.newEvidence) evidenceById.set(record.id, record);
  const findings: Finding[] = [];
  const identityAssignments: FindingIdentityAssignment[] = [];

  for (const draft of drafts) {
    const violation = evidenceViolation(draft, evidenceById);
    if (violation !== undefined) {
      evaluated.push({
        ruleId: draft.ruleId,
        category: draft.category,
        status: 'insufficient_evidence',
        detail: `a draft titled "${draft.title}" was dropped because its ${violation}`,
      });
      continue;
    }
    const evidenceIds = claimEvidenceIds(draft);

    /*
     * The same admissibility test as the one above, applied to the word rather than to the citation.
     *
     * `observed` means a machine watched it happen. A rule that reaches for it when no run produced a
     * span is not overconfident, it is describing a different kind of claim, and the audit that did
     * exactly this reported an exercise rate of zero percent with a confidence of 0.98 against six
     * tools that had run. The check lives here rather than inside any rule so that a rule added later
     * inherits it, and the drop is recorded rather than thrown so a defect in one rule cannot take a
     * reader's whole audit down with it.
     */
    if (!basisIsSupportable(draft.basis, context.observedRuns.length)) {
      evaluated.push({
        ruleId: draft.ruleId,
        category: draft.category,
        status: 'insufficient_evidence',
        detail: `a draft titled "${draft.title}" claimed an observed basis and no run produced a span to observe`,
      });
      continue;
    }

    const identity = identityFor(draft);
    identityAssignments.push(identity);
    findings.push(
      toFinding(
        draft,
        input,
        identity,
        componentIds,
        evidenceIds,
        evidenceSourceLocations(evidenceIds, evidenceById),
      ),
    );
  }

  assertNoFindingIdentityCollisions(identityAssignments);

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
