import { formatCount } from '@orchescope/domain';
import type {
  Component,
  Edge,
  Finding,
  Goal,
  MetricDelta,
  Presence,
  ReconciliationDelta,
} from '@orchescope/schema';
import type { AgentNextAction } from './loop-action.ts';

/**
 * The text mirror of a structured answer.
 *
 * `get_findings` returned `2 of 2 findings.` as the whole of its text content: every identifier,
 * severity, title, component and eligibility flag was in `structuredContent` alone. A client that renders
 * the text block showed its reader nothing, and a model that does not know to look at the structured
 * payload reported that it had found two findings and nothing about them.
 *
 * A digest line is one record, written as a sentence, so the same line serves a person reading a
 * transcript and a model reading the result. It mirrors what the structured payload already carries
 * rather than adding to it, which is what keeps output bounded: the page size that bounds the payload
 * bounds the digest with it, and there is no second limit to reason about.
 */

/** How many identifiers a line names before it counts the rest. */
const NAMED_LIMIT = 3;

const named = (ids: readonly string[]): string => {
  if (ids.length === 0) return 'no component';
  const shown = ids.slice(0, NAMED_LIMIT).join(', ');
  return ids.length > NAMED_LIMIT ? `${shown} and ${ids.length - NAMED_LIMIT} more` : shown;
};

const confidence = (value: number): string => value.toFixed(2);

export const findingDigest = (finding: Finding): string =>
  `${finding.id} ${finding.severity} ${finding.category} ${finding.polarity}: ${finding.title}. ${named(finding.components)}. ${finding.basis}, confidence ${confidence(finding.confidence)}.${finding.goalReadiness.eligible ? ' Goal eligible.' : ''}`;

/**
 * Presence said in the product's own words. `{ static: true, runtime: false }` is the central fact of a
 * reconciliation and it reads as a pair of booleans only to someone who already knows which is which.
 */
const presenceWords = (presence: Presence): string => {
  if (presence.static && presence.runtime) return 'declared and exercised';
  if (presence.runtime) return 'exercised, no exact static identity match';
  return presence.manifest
    ? 'declared in the manifest, never exercised'
    : 'declared, never exercised';
};

export const componentDigest = (component: Component): string => {
  const location = component.sourceLocations[0];
  const where = location === undefined ? '' : ` ${location.file}:${location.startLine}`;
  const effect = component.sideEffect === undefined ? '' : ` effect ${component.sideEffect}.`;
  return `${component.id} ${component.kind}: ${component.displayName}, ${presenceWords(component.presence)}, ${component.basis} at confidence ${confidence(component.confidence)}.${effect}${where}`;
};

export const edgeDigest = (edge: Edge): string => {
  const executions = edge.observation?.executionCount ?? 0;
  const seen =
    executions === 0
      ? edge.runtimeOnly
        ? 'observed, no exact declared relation match'
        : 'declared, never exercised'
      : `${formatCount(executions, 'execution')}`;
  return `${edge.kind} ${edge.from} to ${edge.to}, ${seen}.`;
};

const SOURCE_REFUSAL_LIMIT = 10;

export const behavioralAccountDigest = (delta: ReconciliationDelta): readonly string[] => {
  const account = delta.behavioralAccount;
  if (account === undefined) return [];
  const population =
    account.status === 'complete'
      ? 'complete accepted-span population'
      : `incomplete accepted-span subset; ${formatCount(account.droppedSpans, 'span')} dropped and ${formatCount(account.rejectedSpans, 'span')} rejected`;
  return [
    `Behavioral account over the ${population}: ${formatCount(account.acceptedSpans, 'accepted span')}, ${formatCount(account.executedComponents, 'executed component')}, ${formatCount(account.componentExecutions, 'component execution')}, ${formatCount(account.observedStructuralRelations, 'independently observed structural relation')}, and ${formatCount(account.qualifiedDeclaredRelations, 'declared relation')} qualified for the strict exercise rate.`,
  ];
};

/** The bounded behavioral context the audit mirrors beside a strict zero relation exercise rate. */
export const auditBehaviorDigest = (delta: ReconciliationDelta): readonly string[] => {
  const account = delta.behavioralAccount;
  if (
    account === undefined ||
    account.executedComponents === 0 ||
    delta.coverage.edgeExerciseRate !== 0
  ) {
    return [];
  }
  return behavioralAccountDigest(delta);
};

const sourceIdentityDigest = (delta: ReconciliationDelta): readonly string[] => {
  const refusals = (delta.coverage.missingSpanAttributes ?? []).filter(
    (entry) => entry.purpose === 'source_identity' || entry.purpose === 'code_location',
  );
  const shown = refusals.slice(0, SOURCE_REFUSAL_LIMIT).map((entry) => {
    const cited = entry.evidence?.length ?? 0;
    const omitted = entry.evidenceOmitted ?? Math.max(0, entry.observedComponents - cited);
    return `Exact source identity unavailable for ${formatCount(entry.observedComponents, 'observed component')}: ${entry.attribute}${entry.reason === undefined ? '' : ` (${entry.reason})`}; ${formatCount(cited, 'evidence sample')} cited and ${formatCount(omitted, 'affected observation')} omitted.`;
  });
  if (refusals.length > shown.length) {
    shown.push(
      `${formatCount(refusals.length - shown.length, 'additional exact source-identity refusal')} omitted from this bounded digest.`,
    );
  }
  if (delta.joins.byKindAndName > 0) {
    shown.push(
      `${formatCount(delta.joins.byKindAndName, 'component')} joined by heuristic kind and name only, not by exact code location.`,
    );
  }
  return shown;
};

/**
 * The four deltas, each as one line naming what it holds.
 *
 * The counts are already in the headline; what a reader cannot get from a count is which components are
 * in each group, which is the whole answer this tool exists to give.
 */
export const reconciliationDigest = (delta: ReconciliationDelta): readonly string[] => [
  `Declared and never exercised: ${named(delta.declaredNotExercised.components)}.`,
  `Exercised without an exact static identity match: ${named(delta.exercisedNotDeclared.components)}.`,
  ...behavioralAccountDigest(delta),
  ...sourceIdentityDigest(delta),
  ...delta.contradictions.map(
    (entry) =>
      `Contradiction on ${entry.componentId} (${entry.kind}): declared ${entry.declared}, observed ${entry.observed}.`,
  ),
  ...delta.duplicateSideEffects.map(
    (entry) =>
      `Duplicated effect ${entry.key}${entry.componentId === undefined ? '' : ` on ${entry.componentId}`}, ${formatCount(entry.occurrences, 'occurrence')} in one run, ${entry.idempotencyKeyPresent ? 'an idempotency key was present' : 'no idempotency key was present'}.`,
  ),
];

/**
 * A metric delta with its sample sizes, because a direction without them is the claim this repository
 * refuses to make. A metric the comparison carries no value for says so rather than reading as zero.
 */
export const metricDeltaDigest = (delta: MetricDelta): string => {
  const value = (side: number | undefined): string =>
    side === undefined ? 'no value' : `${side} ${delta.unit}`;
  const caveat = delta.caveat === undefined ? '' : ` ${delta.caveat}`;
  return `${delta.metric}: ${value(delta.baseline)} to ${value(delta.candidate)}, ${delta.direction}, over ${formatCount(delta.baselineSamples, 'baseline sample')} and ${formatCount(delta.candidateSamples, 'candidate sample')}.${caveat}`;
};

/**
 * What a goal binds, without the prompt.
 *
 * The implementer prompt is the substance and it is long, so it stays in the payload where a caller can
 * take it whole. What belongs in the text is the shape of the task: what has to be true at the end, what
 * may be edited, and what decides it.
 */
export const goalDigest = (goal: Goal): readonly string[] => [
  `${goal.id} ${goal.status}, risk ${goal.risk}, from finding ${goal.findingId}: ${goal.title}`,
  ...goal.acceptanceCriteria.map(
    (criterion) => `${criterion.id} ${criterion.statement} (${criterion.check.kind})`,
  ),
  `May write: ${goal.scope.allowedWritePaths.join(', ') || 'nothing'}.`,
  ...goal.validation.commands.map((entry) => `Run: ${entry.command.join(' ')}`),
];

/**
 * The one next action, said as a command a caller can run and a tool it can call.
 *
 * A closed loop has no next action, and saying so is the answer rather than the absence of one.
 */
export const nextActionDigest = (action: AgentNextAction | null): readonly string[] => {
  if (action === null) return ['Next: nothing, the loop is closed.'];
  if (action.kind === 'instruction') return [`Next: ${action.text}`];
  const tool =
    action.tool === null
      ? ''
      : ` MCP tool: ${action.tool.name} ${JSON.stringify(action.tool.arguments)}.`;
  return [`Next: ${action.argv.join(' ')}.${tool}`];
};

/** A criterion, with the third state said as a word rather than left to be inferred from two booleans. */
export const criterionDigest = (outcome: {
  readonly criterion: { readonly id: string; readonly statement: string };
  readonly satisfied: boolean;
  readonly decided: boolean;
  readonly detail: string;
}): string =>
  `${outcome.criterion.id} ${outcome.satisfied ? 'satisfied' : outcome.decided ? 'not satisfied' : 'undecided'}: ${outcome.criterion.statement}. ${outcome.detail}`;
