/**
 * Human readable descriptions of evidence records, one shape per evidence kind.
 *
 * The rendering is deliberately literal. An evidence record is the thing a reader disputes a finding
 * with, so the page shows what the record says and where it came from rather than a summary of it.
 */

import type { Evidence } from '@orchescope/schema';
import { formatMetricValue, formatSourceLocation, humanise } from './format.ts';

export interface EvidenceField {
  readonly label: string;
  readonly value: string;
  /** Rendered in a monospaced cell: paths, pointers, identifiers and excerpts. */
  readonly code?: boolean;
}

export interface EvidenceView {
  readonly id: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly basis: string;
  readonly producer: string;
  readonly headline: string;
  readonly fields: readonly EvidenceField[];
}

function optional(
  label: string,
  value: string | undefined,
  code = false,
): readonly EvidenceField[] {
  if (value === undefined || value.length === 0) {
    return [];
  }
  return [{ label, value, ...(code ? { code: true } : {}) }];
}

function sourceSpanView(evidence: Extract<Evidence, { kind: 'source_span' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  const where = formatSourceLocation(
    evidence.location.file,
    evidence.location.startLine,
    evidence.location.endLine,
  );
  return {
    headline: where,
    fields: [
      { label: 'Location', value: where, code: true },
      ...optional('Symbol', evidence.symbol, true),
      ...optional('Excerpt', evidence.excerpt, true),
      ...optional('File digest', evidence.location.fileHash, true),
    ],
  };
}

function configEntryView(evidence: Extract<Evidence, { kind: 'config_entry' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  const where = `${evidence.location.file}${evidence.location.pointer}`;
  return {
    headline: where,
    fields: [
      { label: 'File', value: evidence.location.file, code: true },
      { label: 'Pointer', value: evidence.location.pointer || '/', code: true },
      ...optional('Value', evidence.value, true),
      ...optional('File digest', evidence.location.fileHash, true),
    ],
  };
}

function spanView(evidence: Extract<Evidence, { kind: 'span' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: evidence.spanName,
    fields: [
      { label: 'Span', value: evidence.spanName, code: true },
      { label: 'Run', value: evidence.runId, code: true },
      { label: 'Trace', value: evidence.traceId, code: true },
      { label: 'Span id', value: evidence.spanId, code: true },
      ...optional('Attribute', evidence.attribute, true),
      ...optional('Attribute value', evidence.attributeValue, true),
    ],
  };
}

function metricView(evidence: Extract<Evidence, { kind: 'metric' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: `${evidence.metric} = ${formatMetricValue(evidence.value, evidence.unit)}`,
    fields: [
      { label: 'Metric', value: evidence.metric, code: true },
      { label: 'Value', value: formatMetricValue(evidence.value, evidence.unit) },
      { label: 'Sample size', value: String(evidence.sampleSize) },
      { label: 'Run', value: evidence.runId, code: true },
      ...optional('Component', evidence.componentId, true),
    ],
  };
}

function scenarioOutcomeView(evidence: Extract<Evidence, { kind: 'scenario_outcome' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: `${evidence.scenarioId}: ${evidence.outcome}`,
    fields: [
      { label: 'Scenario', value: evidence.scenarioId, code: true },
      ...optional('Variant', evidence.variantId, true),
      { label: 'Outcome', value: humanise(evidence.outcome) },
      { label: 'Run', value: evidence.runId, code: true },
      ...optional('Evaluator', evidence.evaluator),
      ...optional('Detail', evidence.detail),
    ],
  };
}

function dependencyView(evidence: Extract<Evidence, { kind: 'dependency' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: `${evidence.packageName} (${evidence.ecosystem})`,
    fields: [
      { label: 'Package', value: evidence.packageName, code: true },
      { label: 'Ecosystem', value: evidence.ecosystem },
      ...optional('Version range', evidence.versionRange, true),
      { label: 'Manifest', value: evidence.manifest, code: true },
    ],
  };
}

function faultView(evidence: Extract<Evidence, { kind: 'fault_injection' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: `${humanise(evidence.faultKind)} into ${evidence.target}`,
    fields: [
      { label: 'Fault', value: humanise(evidence.faultKind) },
      { label: 'Target', value: evidence.target, code: true },
      { label: 'Times applied', value: String(evidence.appliedCount) },
      { label: 'Run', value: evidence.runId, code: true },
    ],
  };
}

function interpretationView(evidence: Extract<Evidence, { kind: 'model_interpretation' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: `${evidence.provider} ${evidence.model}`,
    fields: [
      { label: 'Task', value: evidence.taskId, code: true },
      { label: 'Provider', value: evidence.provider },
      { label: 'Model', value: evidence.model, code: true },
      { label: 'Prompt digest', value: evidence.promptHash, code: true },
      ...optional('Transcript digest', evidence.transcriptRef, true),
      {
        label: 'Grounded in',
        value: evidence.groundedIn.join(', ') || '(nothing recorded)',
        code: true,
      },
      { label: 'Reviewed', value: evidence.reviewed ? 'yes' : 'no' },
      ...optional('Review verdict', evidence.reviewVerdict),
    ],
  };
}

function derivedView(evidence: Extract<Evidence, { kind: 'derived' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: evidence.rule,
    fields: [
      { label: 'Rule', value: evidence.rule, code: true },
      { label: 'Derived from', value: evidence.inputs.join(', '), code: true },
      ...optional('Note', evidence.note),
    ],
  };
}

function absenceView(evidence: Extract<Evidence, { kind: 'absence' }>): {
  headline: string;
  fields: readonly EvidenceField[];
} {
  return {
    headline: `Searched for ${evidence.searched}, found none`,
    fields: [
      { label: 'Searched for', value: evidence.searched },
      { label: 'Scope', value: evidence.scope, code: true },
      { label: 'Items inspected', value: String(evidence.inspectedCount) },
    ],
  };
}

function bodyFor(evidence: Evidence): { headline: string; fields: readonly EvidenceField[] } {
  switch (evidence.kind) {
    case 'source_span':
      return sourceSpanView(evidence);
    case 'config_entry':
      return configEntryView(evidence);
    case 'dependency':
      return dependencyView(evidence);
    case 'span':
      return spanView(evidence);
    case 'metric':
      return metricView(evidence);
    case 'scenario_outcome':
      return scenarioOutcomeView(evidence);
    case 'fault_injection':
      return faultView(evidence);
    case 'model_interpretation':
      return interpretationView(evidence);
    case 'derived':
      return derivedView(evidence);
    case 'absence':
      return absenceView(evidence);
    default:
      return { headline: 'Unrecognised evidence kind', fields: [] };
  }
}

export function viewEvidence(evidence: Evidence): EvidenceView {
  const body = bodyFor(evidence);
  return {
    id: evidence.id,
    kind: evidence.kind,
    kindLabel: humanise(evidence.kind),
    basis: evidence.basis,
    producer: evidence.producer,
    headline: body.headline,
    fields: body.fields,
  };
}

/** A source location an editor can be asked to open, when the evidence carries one. */
export function evidenceLocation(
  evidence: Evidence,
): { readonly file: string; readonly line: number } | null {
  if (evidence.kind === 'source_span') {
    return { file: evidence.location.file, line: evidence.location.startLine };
  }
  if (evidence.kind === 'config_entry') {
    return { file: evidence.location.file, line: 1 };
  }
  if (evidence.kind === 'dependency') {
    return { file: evidence.manifest, line: 1 };
  }
  return null;
}
