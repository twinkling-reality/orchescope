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
 *
 * There is a builder here for a kind only where something writes it. `Evidence` carries ten kinds and this
 * file holds seven, because `dependency`, `scenario_outcome` and `model_interpretation` are terms in a
 * published contract that no build has ever produced. A builder for one of those is not a smaller version
 * of the feature: it is the shape ADR 0002 removed, a path assembled up to the point where something would
 * have to call it. Narrowing the union to match is a change to a published document and is a decision on
 * its own evidence rather than a tidy up.
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

/** Deduplicates evidence by identifier while preserving first insertion order. */
export const dedupeEvidence = (records: readonly Evidence[]): readonly Evidence[] => {
  const byId = new Map<string, Evidence>();
  for (const record of records) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  return [...byId.values()];
};
