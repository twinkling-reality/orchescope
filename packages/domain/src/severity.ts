import type { ClaimBasis, Confidence, Severity } from '@orchescope/schema';

/**
 * Severity, confidence and basis policy.
 *
 * The rule that matters: a claim may not be presented more strongly than its evidence allows. A
 * finding built only on inference cannot be critical, and a model interpreted claim cannot exceed
 * medium severity no matter how confident the model sounded.
 */

const SEVERITY_ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export const severityRank = (severity: Severity): number => SEVERITY_ORDER.indexOf(severity);

export const compareSeverity = (left: Severity, right: Severity): number =>
  severityRank(right) - severityRank(left);

/** Strength of evidence, strongest first. Used when two adapters disagree about the same fact. */
const BASIS_STRENGTH: Readonly<Record<ClaimBasis, number>> = {
  observed: 5,
  discovered: 4,
  simulated: 3,
  inferred: 2,
  estimated: 1,
  model_interpreted: 0,
};

export const basisStrength = (basis: ClaimBasis): number => BASIS_STRENGTH[basis];

export const strongerBasis = (left: ClaimBasis, right: ClaimBasis): ClaimBasis =>
  BASIS_STRENGTH[left] >= BASIS_STRENGTH[right] ? left : right;

const MAX_SEVERITY_BY_BASIS: Readonly<Record<ClaimBasis, Severity>> = {
  observed: 'critical',
  discovered: 'critical',
  simulated: 'high',
  inferred: 'high',
  estimated: 'medium',
  model_interpreted: 'medium',
};

const MIN_CONFIDENCE_BY_SEVERITY: Readonly<Record<Severity, number>> = {
  critical: 0.9,
  high: 0.75,
  medium: 0.6,
  low: 0.4,
  info: 0,
};

/**
 * Lowers a proposed severity until it is supported by the basis and the confidence. Returns the
 * capped severity together with the reason, which the report shows rather than hides.
 */
export const capSeverity = (
  proposed: Severity,
  basis: ClaimBasis,
  confidence: Confidence,
): { readonly severity: Severity; readonly capReason?: string } => {
  const basisCap = MAX_SEVERITY_BY_BASIS[basis];
  let severity = severityRank(proposed) > severityRank(basisCap) ? basisCap : proposed;
  let capReason =
    severity === proposed ? undefined : `limited to ${severity} because the basis is ${basis}`;

  while (severityRank(severity) > 0 && confidence < MIN_CONFIDENCE_BY_SEVERITY[severity]) {
    const nextIndex = severityRank(severity) - 1;
    const next = SEVERITY_ORDER[nextIndex];
    if (next === undefined) break;
    severity = next;
    capReason = `limited to ${severity} because confidence is ${confidence.toFixed(2)}`;
  }
  return capReason === undefined ? { severity } : { severity, capReason };
};

export const CONFIDENCE_BANDS = {
  deterministic: 0.98,
  strongStructural: 0.85,
  structural: 0.75,
  heuristic: 0.6,
  weak: 0.4,
} as const;
