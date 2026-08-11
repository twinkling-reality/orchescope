/**
 * The fixed presentation contract for Overview.
 *
 * This module selects and orders facts already present in a ReportBundle. It does not derive a new
 * finding, metric or verdict. Every report produces the same four slots, and an unavailable slot
 * carries an explicit refusal rather than disappearing.
 */

import type { Finding, ReportBundle } from '@orchescope/schema';
import { auditCommand, importTraceCommand, manifestCommand, traceCommand } from './commands.ts';
import { buildDeltaMeter, type DeltaMeter } from './delta-meter.ts';
import { buildFindingMixes, type FindingMix, type Polarity } from './finding-mix.ts';
import { type Fraction, fractionOf } from './fraction.ts';
import { countKinds, describeShape } from './system-shape.ts';
import { failedAdapters, nextActions, type NextAction } from './next-actions.ts';
import type { PresentationRefusal } from './presentation-refusal.ts';

export interface InputWarning {
  readonly id: string;
  readonly detail: string;
}

/**
 * The four sets the answer is made of, each one a set a reader can open on the system map.
 *
 * These are derived rather than read straight off `coverage`, and the derivation is the correction this
 * pass exists for. `coverage.declaredComponents` is not the count of parts this repository declares: it
 * is the count of parts a trace could record, and a part that ran without being declared anywhere is
 * inside it. So the old headline counted the same part three times, once in the denominator, once in
 * the exercised numerator and once again past the dashed boundary, and it overstated in the flattering
 * direction: `vercel-ai-chatbot-exercised` reported three of nineteen reached where one of seventeen
 * declared parts was.
 *
 * `seen` is what is left of the reachable set once the never reached and the never declared are taken
 * out of it, which makes the four counts a partition and makes them agree with the map's own filter.
 * Verified against every exercised bundle in the corpus: the three measured sets sum to
 * `coverage.declaredComponents` exactly.
 */
export interface DeltaSets {
  /** Declared here, and a run was seen reaching it. */
  readonly seen: number;
  /** Declared here, and no run was seen reaching it. This is the number the screen leads with. */
  readonly neverSeen: number;
  /** A run reached it, and nothing this scan could read declares it. */
  readonly undeclared: number;
  /** Declared here and reachable by a run at all: `seen + neverSeen`. The denominator. */
  readonly reachable: number;
  /**
   * Written down here and of a kind no trace records: a prompt, a provider, an entry point, the project
   * itself. Not a gap and not a fault, but a reader who sees a smaller denominator than the navigation's
   * component count is owed the difference rather than left to find it.
   */
  readonly untraced: number;
}

/**
 * Where the two halves of the join came from, which is what makes the number above it interpretable.
 *
 * It is product truth that the join is pinned to a revision, and until now that fact was three clicks
 * away inside a chrome menu. It belongs beside the answer it qualifies.
 */
export interface DeltaBasis {
  /** The revision the static side was read at, already rendered, or null when none was recorded. */
  readonly revision: string | null;
  readonly runCount: number;
}

/**
 * What the report did, in one sentence, before any number.
 *
 * Every count on this screen is meaningless to a reader who does not know that this tool read their
 * code and, where a run exists, watched their system work. The reference this composition came from
 * needs no such line because `Completed Interactions` is a noun everybody already owns; `21 parts a run
 * could reach` is not, so the model has to be put on the page rather than assumed.
 */
export interface OverviewPreamble {
  readonly sentence: string;
  /** `5 agents, 7 tools and 2 models, and 18 more`, or empty when there is nothing to describe. */
  readonly shape: string;
}

/**
 * Three states rather than two, because a report with no run in it is not the same as a report with
 * nothing to measure. The declared side of the join is fully known without any run, so the rail is
 * drawn and the delta alone refuses. A repository that declares nothing has no rail to draw.
 */
export type DeltaPresentation =
  | {
      readonly state: 'measured';
      readonly meter: DeltaMeter;
      readonly sets: DeltaSets;
      readonly basis: DeltaBasis;
      readonly warnings: readonly InputWarning[];
    }
  | {
      /**
       * Nothing has been run. There is no share to draw and no picture worth drawing: a rail of parts
       * none of which has been compared against anything is the same mark repeated, which is one bit of
       * information, the length, that the count beside it already gives in full. So this state is one
       * compact instruction rather than a hero, and it is the state thirteen of the sixteen cached
       * reports are in.
       */
      readonly state: 'unmeasured';
      readonly declared: number;
      readonly refusal: PresentationRefusal;
      readonly warnings: readonly InputWarning[];
    }
  | {
      readonly state: 'refused';
      readonly refusal: PresentationRefusal;
      readonly warnings: readonly InputWarning[];
    };

export interface OverviewContextPresentation {
  readonly componentCount: number;
  readonly edgeCount: number;
  readonly filesParsed: number;
  readonly bytesParsed: number;
  readonly filesSkipped: number;
  readonly scanDurationMs: number;
  readonly truncated: boolean;
  /** How much of what the scan opened it could actually read. Skipped files are the remainder. */
  readonly readFiles: Fraction;
}

/**
 * The headline: what this report found, split into the good news and the bad.
 *
 * This slot leads the screen and the join does not, which is the one change this pass exists for. A
 * count of how much of the system a run reached is a fact about the quality of our own measurement; a
 * count of problems is a fact about the reader's system, it has a breakdown worth drawing, and it has a
 * most serious member worth naming. The join is a tile of its own further down, unchanged.
 */
export interface HeadlinePresentation {
  readonly mixes: Readonly<Record<Polarity, FindingMix>>;
  /** The one thing this screen is about. Null only when the report found nothing at all. */
  readonly worst: Finding | null;
  /** The one thing to do about it, which used to be a tile of its own saying something different. */
  readonly action: NextAction | null;
  /** Everything else, as a count and a link rather than as a second answer. */
  readonly moreProblems: number;
  readonly strengths: number;
  /** Present only when neither side holds anything, which is a report that found nothing at all. */
  readonly refusal: PresentationRefusal | null;
}

export interface OverviewPresentation {
  readonly preamble: OverviewPreamble;
  readonly headline: HeadlinePresentation;
  readonly delta: DeltaPresentation;
  readonly context: OverviewContextPresentation;
}

const NOTHING_DECLARED: PresentationRefusal = {
  title: 'We read this repository and did not find a system in it.',
  reason:
    'Nothing here looked like an agent, a model call, a tool or an MCP server. If your system is built in a way this version cannot read, you can write it down yourself.',
  commands: [manifestCommand(), auditCommand()],
};

/** The revision the static side was read at, said the way a person reads a commit line. */
function describeRevision(delta: NonNullable<ReportBundle['reconciliation']>): string | null {
  const { revision } = delta;
  if (revision === undefined) {
    return null;
  }
  const commit = revision.commit ?? revision.ref;
  if (commit === undefined || commit === null) {
    return null;
  }
  const short = commit.length > 10 ? commit.slice(0, 10) : commit;
  return revision.dirty ? `${short}, with uncommitted changes` : short;
}

/**
 * Parts a trace can record. Prefer the count baked into the bundle so this module never re-classifies
 * kinds. Fall back to every part when an older bundle omitted the field.
 */
function observableDeclared(bundle: ReportBundle): number {
  return bundle.summary.observableComponentCount ?? bundle.summary.componentCount;
}

function deltaPresentation(bundle: ReportBundle): DeltaPresentation {
  const warnings = failedAdapters(bundle);
  const delta = bundle.reconciliation;
  if (delta === undefined) {
    const declared = observableDeclared(bundle);
    if (bundle.summary.componentCount === 0) {
      return { state: 'refused', refusal: NOTHING_DECLARED, warnings };
    }
    return {
      state: 'unmeasured',
      declared,
      refusal: {
        title: 'Nothing has been run yet',
        reason:
          'Which of these parts your system actually uses is unknown rather than none, and it stays unknown until one run is recorded.',
        commands: [traceCommand(), importTraceCommand()],
      },
      warnings,
    };
  }

  const undeclared = delta.exercisedNotDeclared.components.length;
  if (delta.coverage.declaredComponents === 0) {
    return {
      state: 'refused',
      refusal:
        undeclared === 0
          ? NOTHING_DECLARED
          : {
              ...NOTHING_DECLARED,
              reason: `${undeclared} ${undeclared === 1 ? 'thing' : 'things'} showed up in a run, and your code does not mention any of them. If your system is built in a way this version cannot read, you can write it down yourself.`,
            },
      warnings,
    };
  }

  const neverSeen = delta.declaredNotExercised.components.length;
  const seen = Math.max(0, delta.coverage.declaredComponents - neverSeen - undeclared);
  const reachable = seen + neverSeen;
  /*
   * Parts of a kind no trace records. Prefer the baked observable count so a cached bundle and a
   * fresh one agree; fall back to the partition identity `total - reachable - undeclared` when an
   * older bundle omitted the field.
   */
  const untraced = Math.max(
    0,
    bundle.summary.observableComponentCount === undefined
      ? bundle.summary.componentCount - reachable - undeclared
      : bundle.summary.componentCount - bundle.summary.observableComponentCount,
  );

  return {
    state: 'measured',
    meter: buildDeltaMeter({
      declared: reachable,
      exercised: seen,
      exercisedNotDeclared: undeclared,
    }),
    sets: { seen, neverSeen, undeclared, reachable, untraced },
    basis: {
      revision: describeRevision(delta),
      runCount: delta.declaredNotExercised.runIds.length,
    },
    warnings,
  };
}

function preamble(bundle: ReportBundle): OverviewPreamble {
  const runs = bundle.summary.runCount;
  const found = bundle.summary.componentCount;
  if (found === 0) {
    return { sentence: 'We read this repository and did not find a system in it.', shape: '' };
  }
  /*
   * The no-run sentence used to carry a second clause saying nothing had been run. The next action
   * directly below it is `Watch the system run once`, with its own reason and its own command, so the
   * clause was the first of four sentences on one screen delivering one fact.
   */
  return {
    sentence:
      runs === 0
        ? 'We read your code.'
        : `We read your code, then watched your system run ${runs} ${runs === 1 ? 'time' : 'times'}.`,
    shape: describeShape(countKinds(bundle.graph.components)),
  };
}

/**
 * One answer, and everything else is a link.
 *
 * The screen this replaced answered `what do I do` five ways at once and two of them printed the same
 * finding twice, two hundred pixels apart: a hero naming the most serious one, a tile listing the top
 * three, and a third tile naming a goal to hand off. A reader who is given five answers has been given
 * none, which is what six passes of rewording could not fix because the fault was the count of answers
 * rather than their wording.
 *
 * So the worst one and the thing to do about it are the same block, and the rest of the report is a row
 * of counts under it that link to where they live.
 */
function headlinePresentation(bundle: ReportBundle): HeadlinePresentation {
  const mixes = buildFindingMixes(bundle.findings);
  const [action] = nextActions(bundle);
  /*
   * The branch used to be `shown.total > 0`, which is a count of findings rather than a count of
   * things worth leading with. On `flask`, `express` and `axios` that count is one and the one is
   * `observability-coverage`, so the hero staged our own blind spot as the most serious thing found.
   */
  const shown = mixes.risk.worst !== null ? mixes.risk : mixes.strength;
  if (shown.worst !== null) {
    return {
      mixes,
      worst: shown.worst,
      action: action ?? null,
      moreProblems: Math.max(0, mixes.risk.total - 1),
      strengths: mixes.strength.total,
      refusal: null,
    };
  }
  /*
   * Nothing here is about the reader's system, so the screen says that in one sentence and stops. The
   * command is the next action's, immediately below, so this carries none: a refusal that repeats the
   * block under it is the duplication this whole pass exists to remove.
   */
  const needsRuntime = bundle.summary.runCount === 0;
  return {
    mixes,
    worst: null,
    action: action ?? null,
    moreProblems: 0,
    strengths: 0,
    refusal: {
      /*
       * Four lines sit in this block and each one has to earn its place. The preamble already says we
       * read the code, and the next action already says most problems need a run, so the title says
       * neither. What is left is the one thing nothing else on the screen says, which is that an empty
       * result is not a clean bill of health.
       */
      title: 'Nothing in it is worth reporting.',
      reason: 'That is not the same as your system being fine.',
      commands: needsRuntime ? [] : [auditCommand()],
    },
  };
}

export function buildOverviewPresentation(bundle: ReportBundle): OverviewPresentation {
  const coverage = bundle.graph.coverage;
  return {
    preamble: preamble(bundle),
    headline: headlinePresentation(bundle),
    delta: deltaPresentation(bundle),
    context: {
      componentCount: bundle.summary.componentCount,
      edgeCount: bundle.summary.edgeCount,
      filesParsed: coverage.filesParsed,
      bytesParsed: coverage.bytesParsed,
      filesSkipped: coverage.skipped.length,
      scanDurationMs: coverage.durationMs,
      truncated: coverage.truncated,
      readFiles: fractionOf(coverage.filesParsed, coverage.filesParsed + coverage.skipped.length),
    },
  };
}
