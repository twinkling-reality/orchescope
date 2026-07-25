/**
 * Evidence class and severity vocabulary for the browser workspace.
 *
 * Every value shown in the report carries the class of evidence it rests on. The label is always
 * rendered as text and always paired with a non colour marker, so the distinction survives a
 * monochrome screen, a colour vision deficiency and a printed page.
 */

import type { ClaimBasis, Severity } from '@orchescope/schema';

export interface BasisDescriptor {
  /** Machine value from the bundle. */
  readonly value: string;
  /** Short label shown in the badge. */
  readonly label: string;
  /** Non colour marker rendered next to the label. */
  readonly marker: string;
  /** What the class means, shown as the badge title and in the legend. */
  readonly meaning: string;
  /** True when the value did not come from a measurement of the running system. */
  readonly measured: boolean;
}

export const BASIS_ORDER: readonly ClaimBasis[] = [
  'observed',
  'discovered',
  'inferred',
  'estimated',
  'simulated',
  'model_interpreted',
];

const DESCRIPTORS: Readonly<Record<ClaimBasis, BasisDescriptor>> = {
  observed: {
    value: 'observed',
    label: 'Observed',
    marker: '◉',
    meaning: 'Seen in a runtime trace of the system actually executing.',
    measured: true,
  },
  discovered: {
    value: 'discovered',
    label: 'Discovered',
    marker: '◧',
    meaning: 'Read from source code or configuration, not executed.',
    measured: false,
  },
  inferred: {
    value: 'inferred',
    label: 'Inferred',
    marker: '◇',
    meaning: 'Derived from other evidence by a deterministic rule.',
    measured: false,
  },
  estimated: {
    value: 'estimated',
    label: 'Estimated',
    marker: '≈',
    meaning: 'Computed from a model of the system rather than measured.',
    measured: false,
  },
  simulated: {
    value: 'simulated',
    label: 'Simulated',
    marker: '⚡',
    meaning: 'Produced while faults were injected, so it is not steady state behaviour.',
    measured: true,
  },
  model_interpreted: {
    value: 'model_interpreted',
    label: 'Model interpreted',
    marker: '✎',
    meaning: 'Proposed by a language model and checked against the supplied evidence.',
    measured: false,
  },
};

const UNKNOWN_BASIS: BasisDescriptor = {
  value: 'unknown',
  label: 'Unknown basis',
  marker: '?',
  meaning: 'This report used an evidence class this page does not recognise.',
  measured: false,
};

/** Never throws: an unrecognised basis is reported as unknown rather than hidden. */
export function describeBasis(basis: string): BasisDescriptor {
  const known = Object.hasOwn(DESCRIPTORS, basis)
    ? DESCRIPTORS[basis as ClaimBasis]
    : { ...UNKNOWN_BASIS, value: basis };
  return known;
}

export function basisDescriptors(): readonly BasisDescriptor[] {
  return BASIS_ORDER.map((basis) => DESCRIPTORS[basis]);
}

export interface SeverityDescriptor {
  readonly value: string;
  readonly label: string;
  readonly marker: string;
  readonly rank: number;
}

export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITIES: Readonly<Record<Severity, SeverityDescriptor>> = {
  critical: { value: 'critical', label: 'Critical', marker: '▲▲', rank: 5 },
  high: { value: 'high', label: 'High', marker: '▲', rank: 4 },
  medium: { value: 'medium', label: 'Medium', marker: '■', rank: 3 },
  low: { value: 'low', label: 'Low', marker: '▬', rank: 2 },
  info: { value: 'info', label: 'Info', marker: '●', rank: 1 },
};

export function describeSeverity(severity: string): SeverityDescriptor {
  if (Object.hasOwn(SEVERITIES, severity)) {
    return SEVERITIES[severity as Severity];
  }
  return { value: severity, label: severity, marker: '·', rank: 0 };
}

export function severityRank(severity: string): number {
  return describeSeverity(severity).rank;
}
