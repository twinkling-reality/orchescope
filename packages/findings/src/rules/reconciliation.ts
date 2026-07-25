import { absenceEvidence, CONFIDENCE_BANDS, derivedEvidence } from '@orchescope/domain';
import type { ComponentId, EvidenceId } from '@orchescope/schema';
import { clear, type FindingDraft, fired, insufficient, type Rule } from '../rule.ts';

/**
 * Reconciliation rules: the four deltas between what the repository declares and what a run exercises.
 *
 * These are the rules neither a tracing backend nor a source scanner can produce alone, so each one states
 * both halves of its evidence: the declaration it read and the observation it did or did not make.
 */

const PRODUCER = 'rule:reconciliation';

const componentLabel = (id: ComponentId): string => id;

/**
 * A name that is only the word for what the thing is.
 *
 * `agent` for an agent carries no identity: it says the kind and not which one, so nothing can be joined to it. The
 * comparison is on the shape of the name rather than on a list of library defaults, because a list of the names each
 * library falls back to would be out of date the moment a library changed one.
 */
const carriesNoIdentity = (name: string, kind: string): boolean => {
  const normalise = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
  return normalise(name) === normalise(kind);
};

export const declaredNotExercisedRule: Rule = {
  id: 'declared-not-exercised',
  category: 'scenario_coverage',
  summary: 'Components and relations that exist in the code or configuration and appear in no run.',
  evaluate: (context) => {
    if (context.delta === undefined || context.runs.length === 0) {
      return insufficient('no runs have been ingested, so nothing can be called unexercised');
    }
    const unexercised = context.delta.declaredNotExercised.components;
    if (unexercised.length === 0) return clear('every declared component was exercised');

    const drafts: FindingDraft[] = [];
    for (const componentId of unexercised) {
      const component = context.graph.component(componentId);
      if (component === undefined) continue;
      const record = absenceEvidence({
        producer: PRODUCER,
        searched: `spans attributed to ${componentId}`,
        scope: `${context.runs.length} run(s): ${context.runs.map((entry) => entry.run.id).join(', ')}`,
        inspectedCount: context.runs.length,
      });
      const isTool = component.kind === 'tool';
      drafts.push({
        ruleId: 'declared-not-exercised',
        occurrence: {
          key: 'declared-not-exercised',
          groupedTitle: '{count} declared components were never exercised by an ingested run',
        },
        category: isTool ? 'maintainability' : 'scenario_coverage',
        polarity: 'risk',
        severity: isTool ? 'medium' : 'low',
        confidence: CONFIDENCE_BANDS.strongStructural,
        basis: 'inferred',
        title: `${component.displayName} is declared but never exercised`,
        explanation: `The ${component.kind} ${componentLabel(componentId)} was discovered in the repository and did not appear in any of the ${context.runs.length} ingested run(s). Either no scenario reaches it, or it is unreachable in practice.`,
        impact: isTool
          ? 'A configured tool that never runs is either dead configuration or an untested capability, and both are usually wrong.'
          : 'Coverage of this component is zero, so no runtime claim about it can be made.',
        components: [componentId],
        newEvidence: [record],
        evidence: component.evidence.slice(0, 3) as EvidenceId[],
        goalEligible: false,
        goalReason:
          'Removing or exercising a component is a design decision that needs a human to choose between the two.',
        requiresRuntimeEvidence: true,
        tags: ['reconciliation', 'declared-not-exercised'],
      });
    }
    return fired(drafts);
  },
};

export const exercisedNotDeclaredRule: Rule = {
  id: 'exercised-not-declared',
  category: 'architecture',
  summary: 'Components observed at runtime with no counterpart in the declared model.',
  evaluate: (context) => {
    if (context.delta === undefined) return insufficient('no reconciliation has been performed');
    const undeclared = context.delta.exercisedNotDeclared.components;
    if (undeclared.length === 0) return clear('every observed component matched a declaration');

    const drafts: FindingDraft[] = [];
    let withoutIdentity = 0;
    for (const componentId of undeclared) {
      const component = context.graph.component(componentId);
      if (component === undefined) continue;
      /*
       * A component observed as `agent` was not necessarily undeclared: it was reported under a name that cannot
       * identify anything, so no declaration could have matched it. Claiming it runs undeclared would be an inference
       * the evidence does not support, and `observed-name-carries-no-identity` reports it instead.
       */
      if (carriesNoIdentity(component.displayName, component.kind)) {
        withoutIdentity += 1;
        continue;
      }
      drafts.push({
        ruleId: 'exercised-not-declared',
        occurrence: {
          key: 'exercised-not-declared',
          groupedTitle: '{count} components ran without being declared anywhere in the repository',
        },
        category: 'architecture',
        polarity: 'risk',
        severity:
          component.kind === 'model' || component.kind === 'external_service' ? 'high' : 'medium',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed',
        title: `${component.displayName} runs without being declared anywhere in the repository`,
        explanation: `A span attributed to the ${component.kind} ${componentLabel(componentId)} was observed, and static discovery found no matching declaration. The component is reached through a path Orchescope could not see in the source, for example a transitive dependency, a dynamically registered tool, or a name that differs between the code and the runtime.`,
        impact:
          'A component nobody declared is a component nobody reviews. Cost, permissions and failure behaviour for it are unmanaged.',
        components: [componentId],
        evidence: component.evidence.slice(0, 5) as EvidenceId[],
        recommendation: {
          summary: `Declare ${component.displayName} in the source, or annotate it in .orchescope/manifest.yaml so the graph reflects reality.`,
          steps: [
            'Find the code path that reaches this component using the source location on the span, when one is present.',
            'If the component is intentional, declare it or add it to the manifest with a runtimeName so future scans match it.',
            'If it is not intentional, remove the path that reaches it.',
          ],
          effort: 'small',
          risk: 'low',
        },
        goalEligible: true,
        goalReason: 'The change is bounded: declare the component or annotate it, then rescan.',
        tags: ['reconciliation', 'exercised-not-declared'],
      });
    }
    return fired(
      drafts,
      withoutIdentity === 0
        ? undefined
        : `${withoutIdentity} observed component(s) arrived under a name that is only their kind, which observed-name-carries-no-identity reports instead`,
    );
  },
};

export const contradictedDeclarationRule: Rule = {
  id: 'declaration-contradicted-by-observation',
  category: 'reliability',
  summary: 'A declaration that an observation disagrees with.',
  evaluate: (context) => {
    if (context.delta === undefined) return insufficient('no reconciliation has been performed');
    if (context.delta.contradictions.length === 0) {
      return clear('no declaration was contradicted by an observation');
    }
    const drafts: FindingDraft[] = context.delta.contradictions.map((contradiction) => {
      const component = context.graph.component(contradiction.componentId);
      const isAnnotation =
        contradiction.kind === 'read_only_hint' ||
        contradiction.kind === 'idempotent_hint' ||
        contradiction.kind === 'destructive_hint';
      return {
        ruleId: 'declaration-contradicted-by-observation',
        occurrence: {
          key: 'contradiction',
          groupedTitle: '{count} declarations are contradicted by what was observed',
        },
        category: isAnnotation ? 'security' : 'reliability',
        polarity: 'risk' as const,
        severity: isAnnotation ? ('high' as const) : ('medium' as const),
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed' as const,
        title: `${component?.displayName ?? contradiction.componentId} declares ${contradiction.declared} and behaves otherwise`,
        explanation: `The declaration says ${contradiction.declared}. The observation says ${contradiction.observed}. The Model Context Protocol requires clients to treat tool annotations as untrusted, so Orchescope reports the disagreement rather than deciding which side is right.`,
        impact: isAnnotation
          ? 'A caller that trusts the declaration will make a decision the runtime does not honour, for example retrying an operation it believes is safe.'
          : 'The configured limit is not the limit that applies at runtime.',
        components: [contradiction.componentId],
        evidence: contradiction.evidence,
        taxonomy: isAnnotation ? ['owasp-asi:ASI05'] : [],
        recommendation: {
          summary: 'Correct whichever side is wrong: the declaration or the behaviour.',
          steps: [
            'Confirm the observed behaviour by rerunning the scenario that produced the evidence.',
            'If the behaviour is correct, update the declaration.',
            'If the declaration is correct, fix the implementation so it matches.',
          ],
          effort: 'small',
          risk: 'medium',
        },
        goalEligible: true,
        goalReason: 'The scope is one component and the check is a rerun of the same scenario.',
        requiresHumanReview: isAnnotation,
        tags: ['reconciliation', 'contradiction', contradiction.kind],
      };
    });
    return fired(drafts);
  },
};

export const duplicateSideEffectRule: Rule = {
  id: 'duplicate-side-effect',
  category: 'reliability',
  summary: 'The same logical side effect performed more than once inside one run.',
  evaluate: (context) => {
    if (context.delta === undefined) return insufficient('no reconciliation has been performed');
    if (context.delta.duplicateSideEffects.length === 0) {
      return clear('no side effect was observed more than once in a single run');
    }
    const drafts: FindingDraft[] = context.delta.duplicateSideEffects.map((duplicate) => {
      const component =
        duplicate.componentId === undefined
          ? undefined
          : context.graph.component(duplicate.componentId);
      const attempts = duplicate.retryAttempts.filter((attempt) => attempt > 1);
      const attributed = attempts.length > 0;
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'duplicate-side-effect',
        inputs: duplicate.evidence,
        note: `${duplicate.key} occurred ${duplicate.occurrences} times inside one run${attributed ? ` including attempt ${attempts.join(', ')}` : ''}`,
      });
      return {
        ruleId: 'duplicate-side-effect',
        occurrence: {
          key: 'duplicate',
          groupedTitle: '{count} side effects happened more than once inside one run',
        },
        category: 'reliability' as const,
        polarity: 'risk' as const,
        severity: duplicate.idempotencyKeyPresent ? ('medium' as const) : ('high' as const),
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed' as const,
        title: `${duplicate.key.split('|')[0] ?? 'side effect'} happened ${duplicate.occurrences} times in one run`,
        explanation: `The side effect ${duplicate.key} was recorded ${duplicate.occurrences} times within a single run, and ${duplicate.totalOccurrences} times across ${duplicate.runIds.length} observed run(s)${attributed ? `, and at least one occurrence came from retry attempt ${attempts.join(' and ')}` : ''}. ${duplicate.idempotencyKeyPresent ? 'An idempotency key was present, so the duplication happened despite it.' : 'No idempotency key was present, so nothing downstream can collapse the duplicates.'}`,
        impact:
          'A duplicated external effect is visible to the user or to a third party. For a payment, a notification or a provisioning call, the second one is a real incident.',
        components: component === undefined ? [] : [component.id],
        newEvidence: [record],
        evidence: duplicate.evidence,
        metrics: [
          {
            name: 'duplicate_occurrences',
            value: duplicate.occurrences,
            unit: 'count',
            sampleSize: duplicate.runIds.length,
            basis: 'observed',
          },
        ],
        taxonomy: ['owasp-asi:ASI06'],
        recommendation: {
          summary: duplicate.idempotencyKeyPresent
            ? 'Make the downstream operation honour the idempotency key, or stop retrying it.'
            : 'Attach an idempotency key derived from the request, or stop retrying this operation.',
          steps: [
            'Derive a stable key from the request fields that define the operation.',
            'Pass the key on every attempt, including the first.',
            'Rerun the scenario with the same fault plan and confirm one effect instead of two.',
          ],
          effort: 'small',
          risk: 'medium',
        },
        suggestedExperiment: {
          description:
            'Rerun the scenario that produced the duplicate with the same seed and fault plan.',
          command: ['orchescope', 'chaos', '--scenario', 'scenarios/support-desk.yaml'],
          expectedSignal: 'duplicateSideEffects drops to zero while task success is unchanged',
        },
        goalEligible: true,
        goalReason:
          'The change is local to one operation and the check is a rerun with the same seed.',
        tags: ['reconciliation', 'duplicate-effect'],
      };
    });
    return fired(drafts);
  },
};

/**
 * The join is by name, so a name that identifies nothing is where the join stops.
 *
 * Pointing the delta at a third party repository for the first time produced exactly this: an agent that the
 * repository declares as `support_agent` arrived from the instrumentation as `agent`, so the declaration stayed
 * unexercised and an undeclared component appeared beside it. Neither of those is what happened. What happened is
 * that the run did not say which agent it was, which is a defect in the instrumentation and a bounded one to fix.
 */
export const unnamedObservationRule: Rule = {
  id: 'observed-name-carries-no-identity',
  category: 'observability',
  summary:
    'A component observed under a name that is only its kind, so no declaration can match it.',
  evaluate: (context) => {
    if (context.delta === undefined) return insufficient('no reconciliation has been performed');
    const anonymous = context.delta.exercisedNotDeclared.components
      .map((componentId) => context.graph.component(componentId))
      .filter((component) => component !== undefined)
      .filter((component) => carriesNoIdentity(component.displayName, component.kind));
    if (anonymous.length === 0) {
      return clear('every observed component arrived under a name that identifies something');
    }

    const drafts: FindingDraft[] = anonymous.map((component) => ({
      ruleId: 'observed-name-carries-no-identity',
      occurrence: {
        key: 'unnamed',
        groupedTitle: '{count} components were observed under names that are only their kind',
      },
      category: 'observability' as const,
      polarity: 'risk' as const,
      severity: 'medium' as const,
      confidence: CONFIDENCE_BANDS.deterministic,
      basis: 'observed' as const,
      title: `The observed ${component.kind} is named "${component.displayName}", which is only its kind`,
      explanation: `The instrumentation reported this ${component.kind} as ${component.displayName}, which says what it is rather than which one it is. A name that is only a kind cannot be joined to any declaration, so this run cannot say which declared ${component.kind} it exercised, and a library that reports something with no explicit name usually reports it this way.`,
      impact:
        'Every declaration of that kind stays unexercised in the delta, and the run adds a component nobody declared instead of joining to one. The coverage number is wrong in both directions.',
      components: [component.id],
      evidence: component.evidence.slice(0, 3) as EvidenceId[],
      recommendation: {
        summary: `Give the ${component.kind} an explicit name where it is defined, or map it in .orchescope/manifest.yaml with a runtimeName.`,
        steps: [
          'Name the component at its definition, which is what most libraries emit into the span when it is set.',
          'If the name cannot be changed, declare the mapping with runtimeName in the manifest.',
          'Rerun the same scenario and read the delta again.',
        ],
        effort: 'small' as const,
        risk: 'low' as const,
      },
      goalEligible: true,
      goalReason:
        'Naming a component at its definition is a bounded edit, and the next run shows whether it worked.',
      requiresRuntimeEvidence: true,
      tags: ['reconciliation', 'observability'],
    }));
    return fired(drafts);
  },
};

export const RECONCILIATION_RULES: readonly Rule[] = [
  declaredNotExercisedRule,
  exercisedNotDeclaredRule,
  unnamedObservationRule,
  contradictedDeclarationRule,
  duplicateSideEffectRule,
];
