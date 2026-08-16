/**
 * Where a repository stands in the five step loop this product exists to run.
 *
 * The loop is: audit finds a problem, a goal states what to change and what would prove it, a person
 * or a coding agent makes the change, the same scenario runs again with the same seed, and a
 * comparison says whether it helped. The audit is step one of five, and the value is in step five.
 *
 * The interfaces before this named themselves after pipeline stages, one surface per stage, which put
 * five steps side by side as though all five had happened. On fifteen of the sixteen cached reports
 * four of them never ran, so most of what a reader saw was scaffolding for work nobody had done. Here
 * a step that has not happened is one line naming what would advance it, and a step that ran and came
 * back undecided says so loudly, because that is the most useful sentence the product can print.
 *
 * This module selects and orders facts already in a bundle. It computes no finding, no metric and no
 * verdict of its own: every verdict it reports was decided by `packages/comparison`, and every count
 * it reports was decided by the engine that wrote the bundle.
 */

import { formatCount } from '@orchescope/domain';
import type { Comparison, FindingSet, ReportBundle } from '@orchescope/schema';
import {
  goalCommand,
  scenarioRepeatCommand,
  scenarioRunCommand,
  traceCommand,
} from './commands.ts';

export type LoopStepId = 'audit' | 'goal' | 'rerun' | 'measure' | 'verdict';

/**
 * Three states, and they are carried by a word rather than by a colour, because this output has to
 * read the same in a pipe, in a log and under `NO_COLOR`.
 *
 * `blocked` and `failed` are kept apart on purpose. A step that never ran tells a reader to go and run
 * something. A step that ran and could not decide tells them the run was not enough, which is a
 * different instruction and the one this product is least able to afford losing.
 */
export type LoopStepState = 'done' | 'blocked' | 'failed';

export interface LoopStep {
  readonly id: LoopStepId;
  readonly ordinal: number;
  readonly title: string;
  readonly state: LoopStepState;
  /** One line. Always present, on every state. */
  readonly summary: string;
  /** Zero or more supporting lines, shown under the summary. */
  readonly detail: readonly string[];
  /** The command that advances this step, or null when nothing a reader types would. */
  readonly command: readonly string[] | null;
}

/**
 * How much of the check suite could run.
 *
 * `not_applicable` is left out of both halves. A rule that has nothing to say about this repository is
 * not a check the reader is missing, and counting it as blocked would make every report look
 * under-measured in a way no command could fix.
 */
export interface CheckCoverage {
  readonly ran: number;
  readonly blocked: number;
  readonly total: number;
}

export interface LoopProgress {
  readonly steps: readonly LoopStep[];
  readonly coverage: CheckCoverage;
  /**
   * Where the reader stands: the first incomplete step that carries a command, else the first
   * incomplete step. Null when the loop has closed.
   *
   * A step that is blocked with nothing to type (no eligible finding, no scenario) is not where the
   * reader stands for action: the next step that does carry a command is. Parking on a null command
   * left five of the sixteen corpus reports with no pasteable advance while `trace` waited one row
   * down.
   */
  readonly standingAt: LoopStep | null;
  /**
   * The one argv that advances the loop. Null when nothing a reader types would.
   *
   * Derived from `standingAt` so the terminal, `--json` and MCP name the same command. Steps may
   * still carry their own `command` for readers of the full step list; only this field answers
   * "what do I do".
   */
  readonly nextCommand: readonly string[] | null;
}

type RulesEvaluated = FindingSet['rulesEvaluated'];

export function checkCoverage(rules: RulesEvaluated): CheckCoverage {
  const ran = rules.filter((rule) => rule.status === 'fired' || rule.status === 'clear').length;
  const blocked = rules.filter((rule) => rule.status === 'insufficient_evidence').length;
  return { ran, blocked, total: ran + blocked };
}

/**
 * How many areas a blocked step names before it stops counting.
 *
 * Seven of them ran to ninety characters on `crewai`, which pushed the frame past every terminal it
 * was drawn in and dropped the whole block to unframed lines. Naming the three worst and counting the
 * rest keeps the line bounded whatever the rule set grows to, and the reader loses nothing they could
 * have acted on: the command that lifts all of them is the same one.
 */
const NAMED_AREAS = 3;

/** Categories with a check that could not run, worst first by how many are blocked. */
function blockedAreas(rules: RulesEvaluated): readonly string[] {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    if (rule.status !== 'insufficient_evidence') continue;
    counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category.replaceAll('_', ' '));
}

/**
 * What an empty finding list does and does not mean.
 *
 * An audit that reports nothing means the rules that had enough evidence to fire did not fire. Left
 * unsaid, a reader takes it for a clean bill of health, which is the one misreading this product cannot
 * afford. It lives here rather than beside a renderer so that the terminal and the audit step state the
 * same sentence rather than two copies that drift.
 */
export const ZERO_RISK_CAVEAT =
  'nothing was reported as a problem, which is not the same as nothing being wrong';

function auditStep(bundle: ReportBundle, rules: RulesEvaluated): LoopStep {
  const coverage = checkCoverage(rules);
  const risks = bundle.findings.filter((finding) => finding.polarity === 'risk').length;
  return {
    id: 'audit',
    ordinal: 1,
    title: 'Audit',
    state: 'done',
    summary:
      coverage.total === 0
        ? 'no check had anything to look at'
        : `${coverage.ran} of ${coverage.total} checks ran`,
    detail:
      risks === 0 ? [ZERO_RISK_CAVEAT] : [`${risks} ${risks === 1 ? 'problem' : 'problems'} found`],
    command: null,
  };
}

function goalStep(bundle: ReportBundle): LoopStep {
  if (bundle.goals.length > 0) {
    const count = bundle.goals.length;
    return {
      id: 'goal',
      ordinal: 2,
      title: 'Goal',
      state: 'done',
      summary: `${count} ${count === 1 ? 'job' : 'jobs'} written up`,
      detail: [],
      command: null,
    };
  }
  const eligible =
    bundle.findings.find(
      (finding) => finding.polarity === 'risk' && finding.goalReadiness.eligible,
    ) ?? null;
  /*
   * Without a run, a goal whose acceptance criteria include metric comparisons cannot close step
   * five. Standing then walks to rerun or measure. Eligible findings wait until a baseline exists.
   */
  const readyToHandOff = eligible !== null && bundle.runs.length > 0;
  return {
    id: 'goal',
    ordinal: 2,
    title: 'Goal',
    state: 'blocked',
    summary: 'nothing handed off yet',
    detail:
      eligible !== null && bundle.runs.length === 0
        ? ['needs a baseline run before a goal can be verified']
        : [],
    command: readyToHandOff ? goalCommand(eligible.id) : null,
  };
}

function rerunStep(bundle: ReportBundle): LoopStep {
  if (bundle.scenarioRuns.length > 0) {
    const ran = new Set(bundle.scenarioRuns.map((entry) => entry.scenarioId)).size;
    return {
      id: 'rerun',
      ordinal: 3,
      title: 'Rerun',
      state: 'done',
      summary: `${ran} of ${formatCount(bundle.scenarios.length, 'scenario')} ${bundle.scenarios.length === 1 ? 'has' : 'have'} been run`,
      detail: [],
      command: null,
    };
  }
  const first = bundle.scenarios[0]?.id ?? null;
  return {
    id: 'rerun',
    ordinal: 3,
    title: 'Rerun',
    state: 'blocked',
    summary:
      bundle.scenarios.length === 0
        ? 'no scenario to repeat'
        : `${bundle.scenarios.length} written down, none has ever run`,
    detail: [],
    command: first === null ? null : scenarioRunCommand(first),
  };
}

function namedAreas(areas: readonly string[]): string {
  if (areas.length <= NAMED_AREAS) return areas.join(', ');
  const rest = areas.length - NAMED_AREAS;
  return `${areas.slice(0, NAMED_AREAS).join(', ')} and ${rest} more`;
}

function measureStep(bundle: ReportBundle, rules: RulesEvaluated): LoopStep {
  if (bundle.runs.length === 0) {
    const areas = blockedAreas(rules);
    const coverage = checkCoverage(rules);
    return {
      id: 'measure',
      ordinal: 4,
      title: 'Measure',
      state: 'blocked',
      summary:
        coverage.blocked === 0
          ? 'nothing has been run'
          : `${coverage.blocked} ${coverage.blocked === 1 ? 'check is' : 'checks are'} blocked on a run`,
      detail: areas.length === 0 ? [] : [namedAreas(areas)],
      command: [...traceCommand()],
    };
  }
  const detail: string[] = [];
  const measured = new Set(bundle.componentMetrics.map((entry) => entry.componentId)).size;
  if (measured > 0) {
    detail.push(`${measured} ${measured === 1 ? 'part' : 'parts'} timed`);
  }
  const outcomes = bundle.chaosReports.flatMap((report) => report.outcomes);
  if (outcomes.length > 0) {
    const broke = outcomes.filter((outcome) => !outcome.taskCompleted).length;
    detail.push(
      `${outcomes.length} ${outcomes.length === 1 ? 'fault' : 'faults'} injected, ${broke} broke the task`,
    );
  }
  return {
    id: 'measure',
    ordinal: 4,
    title: 'Measure',
    state: 'done',
    summary: `${bundle.runs.length} ${bundle.runs.length === 1 ? 'run' : 'runs'} recorded`,
    detail,
    command: null,
  };
}

/**
 * The one step whose failure is worth more than its success.
 *
 * A comparison that returns `unchanged` on one run per side has not found that nothing changed. It has
 * found that the evidence cannot tell, and the reason it carries names the sample size. That sentence
 * is the product's whole argument for existing, and it used to sit three clicks deep on a screen with
 * no controls on it.
 */
/**
 * The comparison a reader means when they say "did it help", named once.
 *
 * The store lists comparisons newest first, so the latest is the head. This is exported because the
 * terminal has to name the same one the loop's fifth step named: two surfaces each reaching into the
 * bundle with their own idea of which comparison counts is how a document comes to state a verdict and
 * a standing that disagree.
 */
export const latestComparison = (bundle: ReportBundle): Comparison | undefined =>
  bundle.comparisons[0];

/** A verdict the comparison was willing to call, as opposed to one it refused. */
export const isDecided = (comparison: Comparison): boolean =>
  comparison.verdict === 'improved' || comparison.verdict === 'regressed';

function verdictStep(bundle: ReportBundle): LoopStep {
  const comparison = latestComparison(bundle);
  if (comparison === undefined) {
    return {
      id: 'verdict',
      ordinal: 5,
      title: 'Did it help',
      state: 'blocked',
      summary: 'needs a before and an after',
      detail: [],
      command: null,
    };
  }
  const decided = isDecided(comparison);
  const scenario = bundle.scenarios[0]?.id ?? null;
  return {
    id: 'verdict',
    ordinal: 5,
    title: 'Did it help',
    state: decided ? 'done' : 'failed',
    summary: `${comparison.verdict.replaceAll('_', ' ')}: ${comparison.verdictReason}`,
    detail: [],
    command: decided || scenario === null ? null : scenarioRepeatCommand(scenario, 5),
  };
}

/**
 * The step a reader stands at, and the one command that advances it.
 *
 * Prefer the first incomplete step that names an argv. Fall back to the first incomplete step when
 * none does, so a closed loop is the only case that returns null and a stuck loop still names where
 * it is stuck.
 */
const standingStep = (steps: readonly LoopStep[]): LoopStep | null =>
  steps.find((step) => step.state !== 'done' && step.command !== null) ??
  steps.find((step) => step.state !== 'done') ??
  null;

export function loopProgress(bundle: ReportBundle, rules: RulesEvaluated): LoopProgress {
  const steps = [
    auditStep(bundle, rules),
    goalStep(bundle),
    rerunStep(bundle),
    measureStep(bundle, rules),
    verdictStep(bundle),
  ];
  const standingAt = standingStep(steps);
  return {
    steps,
    coverage: checkCoverage(rules),
    standingAt,
    nextCommand: standingAt?.command ?? null,
  };
}
