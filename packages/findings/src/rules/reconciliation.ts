import {
  absenceEvidence,
  CONFIDENCE_BANDS,
  derivedEvidence,
  formatCount,
  normalizeLocalName,
} from '@orchescope/domain';
import type { ComponentId, EvidenceId, ReconciliationDelta } from '@orchescope/schema';
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
 * Observed names the reconciler matched to more than one declaration and joined to none.
 *
 * `joins.ambiguous` holds them as the run reported them, so the comparison is on the normalised form: the
 * CrewAI instrumentor writes a folded `role: >` block into the span verbatim and the name arrives with the
 * newline still on it, while the component minted for it is named by the slug.
 */
const ambiguouslyNamed = (delta: ReconciliationDelta, displayName: string): boolean =>
  delta.joins.ambiguous.some(
    (observed) => normalizeLocalName(observed) === normalizeLocalName(displayName),
  );

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
  summary: 'Components that exist in the code or configuration and appear in no run.',
  evaluate: (context) => {
    if (context.delta === undefined || context.observedRuns.length === 0) {
      return insufficient(
        context.silentRuns.length === 0
          ? 'no runs have been recorded, so nothing can be called unexercised'
          : `${formatCount(context.silentRuns.length, 'run')} produced no span, and a run that measured nothing cannot establish that anything went unexercised`,
      );
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
        scope: `${formatCount(context.observedRuns.length, 'run')}: ${context.observedRuns.map((entry) => entry.run.id).join(', ')}`,
        inspectedCount: context.observedRuns.length,
      });
      const isTool = component.kind === 'tool';
      drafts.push({
        ruleId: 'declared-not-exercised',
        situation: isTool ? 'declared-tool-not-exercised' : 'declared-component-not-exercised',
        occurrence: {
          key: 'declared-not-exercised',
          groupedTitle: '{count} declared components were never exercised by a recorded run',
        },
        category: isTool ? 'maintainability' : 'scenario_coverage',
        polarity: 'risk',
        severity: isTool ? 'medium' : 'low',
        confidence: CONFIDENCE_BANDS.strongStructural,
        basis: 'inferred',
        title: `${component.displayName} is declared but never exercised`,
        explanation: `The ${component.kind} ${componentLabel(componentId)} was discovered in the repository and did not appear in any of the ${formatCount(context.observedRuns.length, 'recorded run')}. Either no scenario reaches it, or it is unreachable in practice.`,
        impact: isTool
          ? 'A configured tool that never runs is either dead configuration or an untested capability, and both are usually wrong.'
          : 'Coverage of this component is zero, so no runtime claim about it can be made.',
        components: [componentId],
        newEvidence: [record],
        claimEvidence: {
          mechanism: [record.id],
          subject: component.evidence.slice(0, 3) as EvidenceId[],
          conclusion: [record.id],
        },
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

/**
 * What this rule handed to another one, so the reader can see both numbers rather than a shorter list.
 *
 * `fired` with nothing left becomes `clear`, and `clear` here claims every observed component matched a
 * declaration. That is why the two diverted populations have rules of their own rather than only a filter:
 * a run whose every observation was refused would otherwise be reported as a run that joined perfectly.
 */
const divertedDetail = (withoutIdentity: number, ambiguous: number): string | undefined => {
  const parts: string[] = [];
  if (withoutIdentity > 0) {
    parts.push(
      `${formatCount(withoutIdentity, 'observed component')} arrived under a name that is only their kind, which observed-name-carries-no-identity reports instead`,
    );
  }
  if (ambiguous > 0) {
    parts.push(
      `${formatCount(ambiguous, 'observed component')} matched more than one declaration, which observed-name-matches-many-declarations reports instead`,
    );
  }
  return parts.length === 0 ? undefined : parts.join('; ');
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
    let ambiguous = 0;
    let incompleteEvidence = 0;
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
      /*
       * Nor was a component whose name matched more than one declaration. The reconciler found several and
       * refused to choose, which is the opposite of finding none, and this rule told a reader that static
       * discovery had found no matching declaration for a name declared three times over.
       * `observed-name-matches-many-declarations` reports it instead.
       */
      if (ambiguouslyNamed(context.delta, component.displayName)) {
        ambiguous += 1;
        continue;
      }
      const staticPopulation = context.graph.graph.components.filter(
        (candidate) => candidate.presence.static,
      ).length;
      const unmatched = absenceEvidence({
        producer: PRODUCER,
        searched: `an exact static ${component.kind} identity matching ${component.id}`,
        scope: 'the statically discovered component population used by reconciliation',
        inspectedCount: staticPopulation,
      });
      const runtimeOnly = component.evidence
        .map((id) => context.evidenceById.get(id))
        .find((record) => record?.kind === 'derived' && record.rule === 'runtime_only_component');
      const exactObserved =
        runtimeOnly?.kind === 'derived'
          ? runtimeOnly.inputs.filter((id) => {
              const record = context.evidenceById.get(id);
              if (record?.kind !== 'span') return false;
              return (
                record.observedComponent?.kind === component.kind &&
                record.observedComponent.observedName === component.displayName
              );
            })
          : [];
      if (runtimeOnly === undefined || exactObserved.length === 0) {
        incompleteEvidence += 1;
        continue;
      }
      drafts.push({
        ruleId: 'exercised-not-declared',
        situation: 'observed-component-without-exact-declaration',
        occurrence: {
          key: 'exercised-not-declared',
          groupedTitle: '{count} components ran without an exact matching static declaration',
        },
        category: 'architecture',
        polarity: 'risk',
        severity:
          component.kind === 'model' || component.kind === 'external_service' ? 'high' : 'medium',
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed',
        title: `${component.displayName} ran without an exact matching static declaration`,
        explanation: `A span attributed to the exact ${component.kind} identity ${componentLabel(componentId)} was observed, and reconciliation found no exact match among ${staticPopulation} statically discovered components. This does not establish that the repository declares no configurable provider path or related component; it establishes only that none carried this exact identity.`,
        impact:
          'Without an exact static match, runtime cost, permissions and failure behaviour cannot be attached to a specific reviewed declaration.',
        components: [componentId],
        newEvidence: [unmatched],
        claimEvidence: {
          mechanism: [runtimeOnly.id, unmatched.id],
          subject: exactObserved.slice(0, 5) as EvidenceId[],
          conclusion: [runtimeOnly.id, unmatched.id],
        },
        recommendation: {
          summary: `Make the exact runtime identity ${component.displayName} match a static declaration or an explicit manifest mapping.`,
          steps: [
            'Find where runtime configuration selects this exact component, using the span source location when one is present.',
            'If the selection is intentional, declare the exact identity or add a manifest runtimeName mapping so future scans match it.',
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
    const diverted = divertedDetail(withoutIdentity, ambiguous);
    const incomplete =
      incompleteEvidence === 0
        ? undefined
        : `${formatCount(incompleteEvidence, 'runtime-only component')} lacked both an exact identity-bearing span and its reconciler derivation`;
    const detail = [diverted, incomplete]
      .filter((entry): entry is string => entry !== undefined)
      .join('; ');
    if (drafts.length === 0 && incompleteEvidence > 0) return insufficient(detail);
    return fired(drafts, detail.length === 0 ? undefined : detail);
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
      /*
       * Five of the six kinds need a run to notice: a side effect that happened, a duplicate attributed
       * to a retry, a call that outlived its timeout. `destructive_hint` needs none, because it compares
       * a declared annotation against the effect class discovery already assigned, and both halves come
       * out of source. Calling that observed would be presenting an inference as an observation, which is
       * the one thing this report may not do. It costs no severity to say so: the ceiling for discovered
       * and observed is the same, and only the word changes.
       */
      const fromSourceAlone = contradiction.kind === 'destructive_hint';
      return {
        ruleId: 'declaration-contradicted-by-observation',
        situation: fromSourceAlone
          ? 'source-annotation-contradiction'
          : isAnnotation
            ? 'observed-annotation-contradiction'
            : 'observed-policy-contradiction',
        occurrence: {
          key: 'contradiction',
          groupedTitle: '{count} declarations are contradicted by what was observed',
        },
        category: isAnnotation ? 'security' : 'reliability',
        polarity: 'risk' as const,
        severity: isAnnotation ? ('high' as const) : ('medium' as const),
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: fromSourceAlone ? ('discovered' as const) : ('observed' as const),
        title: `${component?.displayName ?? contradiction.componentId} declares ${contradiction.declared} and behaves otherwise`,
        explanation: `The declaration says ${contradiction.declared}. ${fromSourceAlone ? 'The code says' : 'The observation says'} ${contradiction.observed}. The Model Context Protocol requires clients to treat tool annotations as untrusted, so Orchescope reports the disagreement rather than deciding which side is right.`,
        impact: isAnnotation
          ? 'A caller that trusts the declaration will make a decision the runtime does not honour, for example retrying an operation it believes is safe.'
          : 'The configured limit is not the limit that applies at runtime.',
        components: [contradiction.componentId],
        claimEvidence: {
          mechanism: contradiction.evidence,
          subject: contradiction.evidence,
          conclusion: contradiction.evidence,
        },
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
        situation: duplicate.idempotencyKeyPresent
          ? 'duplicate-effect-despite-idempotency-key'
          : 'duplicate-effect-without-idempotency-key',
        occurrence: {
          key: 'duplicate',
          groupedTitle: '{count} outside effects happened more than once in one run',
        },
        category: 'reliability' as const,
        polarity: 'risk' as const,
        severity: duplicate.idempotencyKeyPresent ? ('medium' as const) : ('high' as const),
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed' as const,
        title: `${duplicate.key.split('|')[0] ?? 'an outside effect'} happened ${duplicate.occurrences} times in one run`,
        explanation: `The side effect ${duplicate.key} was recorded ${duplicate.occurrences} times within a single run, and ${duplicate.totalOccurrences} times across ${formatCount(duplicate.runIds.length, 'observed run')}${attributed ? `, and at least one occurrence came from retry attempt ${attempts.join(' and ')}` : ''}. ${duplicate.idempotencyKeyPresent ? 'An idempotency key was present, so the duplication happened despite it.' : 'No idempotency key was present, so nothing downstream can collapse the duplicates.'}`,
        impact:
          'A duplicated external effect is visible to the user or to a third party. For a payment, a notification or a provisioning call, the second one is a real incident.',
        components: component === undefined ? [] : [component.id],
        newEvidence: [record],
        claimEvidence: {
          mechanism: [record.id],
          subject: duplicate.evidence,
          conclusion: [record.id],
        },
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

    const drafts: FindingDraft[] = anonymous.map((component) => {
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'observed-name-carries-no-identity',
        inputs: component.evidence as EvidenceId[],
        note: `${component.id} was observed under the kind-only name ${component.displayName}`,
        basis: 'observed',
      });
      return {
        ruleId: 'observed-name-carries-no-identity',
        situation: 'observed-name-is-only-component-kind',
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
          'Every declaration of that kind stays unexercised in the delta, and the run adds a component with no exact identity match instead of joining to one. The coverage number is wrong in both directions.',
        components: [component.id],
        newEvidence: [record],
        claimEvidence: {
          mechanism: [record.id],
          subject: component.evidence.slice(0, 3) as EvidenceId[],
          conclusion: [record.id],
        },
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
      };
    });
    return fired(drafts);
  },
};

/**
 * The join is by name, so a name that means several things is where the join stops.
 *
 * `exercised-not-declared` told a reader that static discovery had found no matching declaration for a name
 * the repository declares three times. It found three and refused to choose, which is the opposite fact, and
 * the sentence had shipped for `supervisor` on the pinned deep research run since that entry was pinned.
 * Reading the packaged CrewAI agents document made it a second entry: a role written once in the crew that
 * ran, once in a copy of that crew, and once as a literal in an application that did not.
 *
 * A refusal is the right answer there, and it is worth more than the confident join it replaced. What it is
 * not is an absence, and the two read identically until one of them says which it is.
 *
 * **No goal is cut from this one.** Clearing it means one of the declarations giving up the name, and this
 * build cannot say which: on the pinned repository two of the three are a crew and a copy of that crew, so
 * renaming either is wrong, and the role of a CrewAI agent is part of its prompt rather than a label. A
 * code location on the span settles it without touching any of them, which is a change to the
 * instrumentation and not to the repository under audit.
 */
export const ambiguousObservationRule: Rule = {
  id: 'observed-name-matches-many-declarations',
  category: 'observability',
  summary:
    'A component observed under a name more than one declaration carries, so none could be joined.',
  evaluate: (context) => {
    if (context.delta === undefined) return insufficient('no reconciliation has been performed');
    const delta = context.delta;
    const contested = delta.exercisedNotDeclared.components
      .map((componentId) => context.graph.component(componentId))
      .filter((component) => component !== undefined)
      /*
       * A name that is only the word for a kind matches every declaration of that kind, so it arrives here as
       * well. It belongs to `observed-name-carries-no-identity`, which owns the actionable half of it: a run
       * that did not say which agent it was is one bounded edit away from saying so, and naming it at the
       * definition settles the ambiguity too. Reporting both would tell a reader two things about one
       * observation and offer the weaker of them second.
       */
      .filter((component) => !carriesNoIdentity(component.displayName, component.kind))
      .filter((component) => ambiguouslyNamed(delta, component.displayName));
    if (contested.length === 0) {
      return clear('every observed name matched at most one declaration');
    }

    const drafts: FindingDraft[] = contested.map((component) => {
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'observed-name-matches-many-declarations',
        inputs: component.evidence as EvidenceId[],
        note: `${component.id} was observed under a name that reconciliation matched to multiple declarations and joined to none`,
        basis: 'observed',
      });
      return {
        ruleId: 'observed-name-matches-many-declarations',
        situation: 'observed-name-matches-multiple-declarations',
        occurrence: {
          key: 'ambiguous',
          groupedTitle:
            '{count} components were observed under names more than one declaration carries',
        },
        category: 'observability' as const,
        polarity: 'risk' as const,
        severity: 'medium' as const,
        confidence: CONFIDENCE_BANDS.deterministic,
        basis: 'observed' as const,
        title: `The observed ${component.kind} "${component.displayName.trim()}" is declared in more than one place`,
        explanation: `The run reported this ${component.kind} as ${component.displayName.trim()}, and more than one declaration in this repository carries that name. Reconciliation joined it to none of them rather than picking one, so this is a refusal rather than evidence that no exact declaration exists. Which declaration the run exercised is a fact this repository has and this build does not.`,
        impact:
          'Every declaration sharing that name stays unexercised in the delta and the run adds a component beside them, so the coverage number is wrong in both directions and no runtime claim can be attached to the declaration it belongs to.',
        components: [component.id],
        newEvidence: [record],
        claimEvidence: {
          mechanism: [record.id],
          subject: component.evidence.slice(0, 3) as EvidenceId[],
          conclusion: [record.id],
        },
        recommendation: {
          summary: `Decide which declaration of ${component.displayName.trim()} the run exercised, or have the instrumentation emit a code location so the join is made by where it ran.`,
          steps: [
            'Read joins.ambiguous in the reconciliation delta for the names, and the declarations sharing each one.',
            'Where the duplicates are two copies of one application, the answer is that they are copies, and only one of them belongs to the system this run measured.',
            'Where they are genuinely different components, give one of them a name of its own, or emit code.file.path on the span so the join no longer depends on the name.',
          ],
          effort: 'medium' as const,
          risk: 'medium' as const,
        },
        goalEligible: false,
        goalReason:
          'Clearing it means one of the declarations giving up a name, and which one is a decision about the repository that this build has no evidence for.',
        requiresRuntimeEvidence: true,
        tags: ['reconciliation', 'observability'],
      };
    });
    return fired(drafts);
  },
};

export const RECONCILIATION_RULES: readonly Rule[] = [
  declaredNotExercisedRule,
  exercisedNotDeclaredRule,
  unnamedObservationRule,
  ambiguousObservationRule,
  contradictedDeclarationRule,
  duplicateSideEffectRule,
];
