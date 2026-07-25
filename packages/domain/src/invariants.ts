import type { Component, Edge, Finding } from '@orchescope/schema';
import { OrchescopeError } from './errors.ts';
import { identityKey } from './identity.ts';
import { severityRank } from './severity.ts';

/**
 * Domain invariants that a schema cannot express.
 *
 * These run before anything is persisted or exported. A violation is a defect in Orchescope, not user
 * error, so it raises an internal error with the offending element named.
 */

export type InvariantViolation = { readonly subject: string; readonly rule: string };

export const componentViolations = (component: Component): readonly InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const subject = component.id;

  if (component.identity.kind !== component.kind) {
    violations.push({ subject, rule: 'identity.kind must equal kind' });
  }
  if (component.details !== undefined && component.details.for !== component.kind) {
    violations.push({ subject, rule: `details.for (${component.details.for}) must equal kind` });
  }
  if (!component.presence.static && !component.presence.runtime && !component.presence.manifest) {
    violations.push({
      subject,
      rule: 'a component must be present statically, at runtime or in a manifest',
    });
  }
  if (
    component.presence.runtime &&
    !component.presence.static &&
    component.basis === 'discovered'
  ) {
    violations.push({ subject, rule: 'a runtime only component cannot claim a discovered basis' });
  }
  if (component.evidence.length === 0) {
    violations.push({ subject, rule: 'a component must carry at least one evidence reference' });
  }
  if (
    component.presence.static &&
    component.sourceLocations.length === 0 &&
    component.configLocations.length === 0
  ) {
    violations.push({
      subject,
      rule: 'a statically present component must have a source or configuration location',
    });
  }
  return violations;
};

export /**
 * Relations a component may have with itself.
 *
 * A graph node that routes back to itself is a real and common shape: it is how a framework expresses "try again", and
 * it is exactly the looping behaviour the finding rules exist to report, so it is recorded rather than dropped. A
 * component containing itself, or invoking itself as a model, would be a construction error.
 */
const SELF_EDGE_KINDS = new Set(['observed_after', 'hands_off_to']);

export const edgeViolations = (
  edge: Edge,
  componentIds: ReadonlySet<string>,
): readonly InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const subject = edge.id;
  if (!componentIds.has(edge.from))
    violations.push({ subject, rule: `unknown source component ${edge.from}` });
  if (!componentIds.has(edge.to))
    violations.push({ subject, rule: `unknown target component ${edge.to}` });
  if (edge.from === edge.to && !SELF_EDGE_KINDS.has(edge.kind)) {
    violations.push({
      subject,
      rule: `a self edge is not meaningful for ${edge.kind}`,
    });
  }
  if (edge.evidence.length === 0) violations.push({ subject, rule: 'an edge must carry evidence' });
  if (edge.runtimeOnly && edge.basis !== 'observed') {
    violations.push({ subject, rule: 'a runtime only edge must have an observed basis' });
  }
  if (!edge.runtimeOnly && edge.observation === undefined && edge.basis === 'observed') {
    violations.push({ subject, rule: 'an observed edge must carry an observation' });
  }
  return violations;
};

export const findingViolations = (
  finding: Finding,
  componentIds: ReadonlySet<string>,
): readonly InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const subject = finding.id;
  if (finding.evidence.length === 0)
    violations.push({ subject, rule: 'a finding must reference evidence' });
  if (finding.components.length === 0 && finding.edges.length === 0) {
    violations.push({ subject, rule: 'a finding must name at least one component or edge' });
  }
  for (const componentId of finding.components) {
    if (!componentIds.has(componentId)) {
      violations.push({ subject, rule: `references unknown component ${componentId}` });
    }
  }
  if (finding.polarity === 'strength' && severityRank(finding.severity) > severityRank('info')) {
    violations.push({ subject, rule: 'a strength must use info severity' });
  }
  if (finding.basis === 'model_interpreted' && finding.confidence > 0.9) {
    violations.push({ subject, rule: 'a model interpreted finding cannot exceed 0.9 confidence' });
  }
  return violations;
};

export const identitiesAreUnique = (
  components: readonly Component[],
): readonly InvariantViolation[] => {
  const seenIdentity = new Map<string, string>();
  const seenId = new Map<string, string>();
  const violations: InvariantViolation[] = [];
  for (const component of components) {
    const key = identityKey(component.identity);
    const previousIdentity = seenIdentity.get(key);
    if (previousIdentity !== undefined) {
      violations.push({
        subject: component.id,
        rule: `duplicate identity, already used by ${previousIdentity}`,
      });
    } else {
      seenIdentity.set(key, component.id);
    }
    const previousId = seenId.get(component.id);
    if (previousId !== undefined) {
      violations.push({ subject: component.id, rule: 'duplicate component identifier' });
    } else {
      seenId.set(component.id, key);
    }
  }
  return violations;
};

export const assertNoViolations = (
  violations: readonly InvariantViolation[],
  context: string,
): void => {
  if (violations.length === 0) return;
  const summary = violations
    .slice(0, 10)
    .map((violation) => `${violation.subject}: ${violation.rule}`)
    .join('; ');
  throw new OrchescopeError('INVALID_STATE', `${context} violated domain invariants: ${summary}`, {
    detail: { violationCount: violations.length },
  });
};
