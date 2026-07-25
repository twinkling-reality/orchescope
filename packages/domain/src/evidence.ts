import type {
  ClaimBasis,
  ConfigLocation,
  Evidence,
  EvidenceId,
  SourceLocation,
} from '@orchescope/schema';
import { evidenceId } from './ids.ts';

/**
 * Evidence construction.
 *
 * Each builder takes the facts and returns a content addressed record: the same fact discovered twice
 * produces the same identifier, so evidence deduplicates naturally and a finding can point at
 * evidence produced by a different subsystem.
 */

type WithoutId<T> = Omit<T, 'id'>;

const withId = <T extends WithoutId<Evidence>>(record: T): T & { id: EvidenceId } => ({
  ...record,
  id: evidenceId(record) as EvidenceId,
});

export const sourceSpanEvidence = (input: {
  readonly producer: string;
  readonly location: SourceLocation;
  readonly symbol?: string;
  readonly excerpt?: string;
  readonly basis?: ClaimBasis;
}): Evidence =>
  withId({
    kind: 'source_span' as const,
    basis: input.basis ?? 'discovered',
    producer: input.producer,
    location: input.location,
    ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
  });

export const configEntryEvidence = (input: {
  readonly producer: string;
  readonly location: ConfigLocation;
  readonly value?: string;
}): Evidence =>
  withId({
    kind: 'config_entry' as const,
    basis: 'discovered' as const,
    producer: input.producer,
    location: input.location,
    ...(input.value === undefined ? {} : { value: input.value }),
  });

export const dependencyEvidence = (input: {
  readonly producer: string;
  readonly manifest: string;
  readonly packageName: string;
  readonly ecosystem: 'npm' | 'pypi';
  readonly versionRange?: string;
}): Evidence =>
  withId({
    kind: 'dependency' as const,
    basis: 'discovered' as const,
    producer: input.producer,
    manifest: input.manifest,
    packageName: input.packageName,
    ecosystem: input.ecosystem,
    ...(input.versionRange === undefined ? {} : { versionRange: input.versionRange }),
  });

export const spanEvidence = (input: {
  readonly producer: string;
  readonly runId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly spanName: string;
  readonly attribute?: string;
  readonly attributeValue?: string;
}): Evidence =>
  withId({
    kind: 'span' as const,
    basis: 'observed' as const,
    producer: input.producer,
    runId: input.runId,
    traceId: input.traceId,
    spanId: input.spanId,
    spanName: input.spanName,
    ...(input.attribute === undefined ? {} : { attribute: input.attribute }),
    ...(input.attributeValue === undefined ? {} : { attributeValue: input.attributeValue }),
  });

export const metricEvidence = (input: {
  readonly producer: string;
  readonly runId: string;
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly sampleSize: number;
  readonly componentId?: string;
  readonly basis?: ClaimBasis;
}): Evidence =>
  withId({
    kind: 'metric' as const,
    basis: input.basis ?? 'observed',
    producer: input.producer,
    runId: input.runId,
    metric: input.metric,
    value: input.value,
    unit: input.unit,
    sampleSize: input.sampleSize,
    ...(input.componentId === undefined ? {} : { componentId: input.componentId }),
  });

export const scenarioOutcomeEvidence = (input: {
  readonly producer: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly outcome: 'success' | 'failure' | 'timeout' | 'budget_exceeded' | 'error';
  readonly variantId?: string;
  readonly evaluator?: string;
  readonly detail?: string;
}): Evidence =>
  withId({
    kind: 'scenario_outcome' as const,
    basis: 'observed' as const,
    producer: input.producer,
    runId: input.runId,
    scenarioId: input.scenarioId,
    outcome: input.outcome,
    ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
    ...(input.evaluator === undefined ? {} : { evaluator: input.evaluator }),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  });

export const faultInjectionEvidence = (input: {
  readonly producer: string;
  readonly runId: string;
  readonly faultKind: string;
  readonly target: string;
  readonly appliedCount: number;
}): Evidence =>
  withId({
    kind: 'fault_injection' as const,
    basis: 'simulated' as const,
    producer: input.producer,
    runId: input.runId,
    faultKind: input.faultKind,
    target: input.target,
    appliedCount: input.appliedCount,
  });

export const derivedEvidence = (input: {
  readonly producer: string;
  readonly rule: string;
  readonly inputs: readonly EvidenceId[];
  readonly note?: string;
  readonly basis?: ClaimBasis;
}): Evidence =>
  withId({
    kind: 'derived' as const,
    basis: input.basis ?? 'inferred',
    producer: input.producer,
    rule: input.rule,
    inputs: [...input.inputs],
    ...(input.note === undefined ? {} : { note: input.note }),
  });

export const absenceEvidence = (input: {
  readonly producer: string;
  readonly searched: string;
  readonly scope: string;
  readonly inspectedCount: number;
}): Evidence =>
  withId({
    kind: 'absence' as const,
    basis: 'inferred' as const,
    producer: input.producer,
    searched: input.searched,
    scope: input.scope,
    inspectedCount: input.inspectedCount,
  });

export const modelInterpretationEvidence = (input: {
  readonly producer: string;
  readonly taskId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptHash: string;
  readonly groundedIn: readonly EvidenceId[];
  readonly reviewed: boolean;
  readonly reviewVerdict?: 'supported' | 'unsupported' | 'conflicting';
  readonly transcriptRef?: string;
}): Evidence =>
  withId({
    kind: 'model_interpretation' as const,
    basis: 'model_interpreted' as const,
    producer: input.producer,
    taskId: input.taskId,
    provider: input.provider,
    model: input.model,
    promptHash: input.promptHash,
    groundedIn: [...input.groundedIn],
    reviewed: input.reviewed,
    ...(input.reviewVerdict === undefined ? {} : { reviewVerdict: input.reviewVerdict }),
    ...(input.transcriptRef === undefined ? {} : { transcriptRef: input.transcriptRef }),
  });

/** Deduplicates evidence by identifier while preserving first insertion order. */
export const dedupeEvidence = (records: readonly Evidence[]): readonly Evidence[] => {
  const byId = new Map<string, Evidence>();
  for (const record of records) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  return [...byId.values()];
};
