/**
 * Evidence class and severity vocabulary for the browser workspace.
 *
 * Every value shown in the report carries the class of evidence it rests on, and it carries it as a
 * word rather than as a colour or a glyph. There is nothing for a marker to compensate for, because
 * nothing here is distinguished by hue in the first place.
 *
 * Severity is the one exception, and it is why the two alert hues exist. The hue is doubled by form
 * so it is never the only signal: critical and high carry two marks and one respectively, medium
 * carries one, and low and info empty theirs out, which is the same filled-means-measured rule the
 * delta bar and the components table use.
 */

import type { ClaimBasis, Severity } from '@orchescope/schema';

export interface BasisDescriptor {
  /** Machine value from the bundle. */
  readonly value: string;
  /** Short label shown in the chip. */
  readonly label: string;
  /** What the class means, shown as the chip title and in the legend. */
  readonly meaning: string;
  /** The same thing in a handful of words, for a line that has to be read at a glance. */
  readonly short: string;
  /** True when the value came from a measurement of the running system. */
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
    short: 'seen while it ran',
    meaning: 'Seen in a runtime trace of the system actually executing.',
    measured: true,
  },
  discovered: {
    value: 'discovered',
    label: 'Discovered',
    short: 'read from your code',
    meaning: 'Read from source code or configuration, not executed.',
    measured: false,
  },
  inferred: {
    value: 'inferred',
    label: 'Inferred',
    short: 'worked out from other evidence',
    meaning: 'Derived from other evidence by a deterministic rule.',
    measured: false,
  },
  estimated: {
    value: 'estimated',
    label: 'Estimated',
    short: 'estimated rather than measured',
    meaning: 'Computed from a model of the system rather than measured.',
    measured: false,
  },
  simulated: {
    value: 'simulated',
    label: 'Simulated',
    short: 'seen while we broke something on purpose',
    meaning: 'Produced while faults were injected, so it is not steady state behaviour.',
    measured: true,
  },
  model_interpreted: {
    value: 'model_interpreted',
    label: 'Model interpreted',
    short: 'proposed by a language model and checked',
    meaning: 'Proposed by a language model and checked against the supplied evidence.',
    measured: false,
  },
};

const UNKNOWN_BASIS: BasisDescriptor = {
  value: 'unknown',
  label: 'Unknown basis',
  short: 'established in a way this page does not recognise',
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

/**
 * The form of a severity marker, which is what carries the ranking when the hue does not.
 *
 * Two hues cover five severities, so hue alone cannot separate them and is never asked to. The mark
 * is a square whose fill and height step down with the rank: doubled, filled, filled and halved,
 * hollow, hollow and halved. All five are distinct in greyscale and the order between them is legible
 * without a legend, because more ink means worse.
 */
export type SeverityMarkShape =
  | 'double'
  | 'filled'
  | 'filled_half'
  | 'hollow'
  | 'hollow_half'
  | 'unranked';

export interface SeverityDescriptor {
  readonly value: string;
  readonly label: string;
  readonly mark: SeverityMarkShape;
  readonly rank: number;
}

export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITIES: Readonly<Record<Severity, SeverityDescriptor>> = {
  critical: { value: 'critical', label: 'Critical', mark: 'double', rank: 5 },
  high: { value: 'high', label: 'High', mark: 'filled', rank: 4 },
  medium: { value: 'medium', label: 'Medium', mark: 'filled_half', rank: 3 },
  low: { value: 'low', label: 'Low', mark: 'hollow', rank: 2 },
  info: { value: 'info', label: 'Info', mark: 'hollow_half', rank: 1 },
};

/**
 * A severity this build does not rank keeps its own name and gets a mark that belongs to no rank, so
 * it cannot be mistaken at a glance for one this build understands.
 */
export function describeSeverity(severity: string): SeverityDescriptor {
  if (Object.hasOwn(SEVERITIES, severity)) {
    return SEVERITIES[severity as Severity];
  }
  return { value: 'unranked', label: severity, mark: 'unranked', rank: 0 };
}

export function severityRank(severity: string): number {
  return describeSeverity(severity).rank;
}
