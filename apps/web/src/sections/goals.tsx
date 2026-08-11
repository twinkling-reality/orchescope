import { formatInteger, humanise } from '../presentation/format.ts';
import { buildSectionPresentations } from '../presentation/section-presentation.ts';
import { useApp } from '../store.tsx';
import { Eyebrow, Meta, RefusalPanel, RuledStat, StatRow } from '../ui/primitives.tsx';
import { SectionSkeleton } from '../ui/section-skeleton.tsx';
import { GoalCard } from './goals/goal-card.tsx';

export function GoalsSection() {
  const app = useApp();
  const { goals } = app.bundle;
  const highlighted = app.state.route.params['goal'] ?? null;
  const presentation = buildSectionPresentations(app.bundle).goals;
  const judgements = new Map(
    (app.bundle.goalValidations ?? []).map((entry) => [entry.goalId, entry]),
  );
  const validated = goals.filter((goal) => goal.status === 'validated').length;
  /*
   * The three numbers on this band have to partition the goals, and before this they did not. The
   * lead read `0 of 2 jobs handed off have actually been checked` beside `Checked in this report 2`
   * and `Still waiting to be checked 2`: nought, two and two, over a total of two. `judgements.size`
   * counts the goals a validation was run against, which is not the same set as the goals whose
   * validation came back satisfied, and the second stat subtracted the wrong one of the two. A
   * reader who tries to reconcile three numbers and cannot stops trusting the page.
   */
  const checkedNotConfirmed = goals.filter(
    (goal) => goal.status !== 'validated' && judgements.has(goal.id),
  ).length;
  const neverChecked = goals.filter((goal) => !judgements.has(goal.id)).length;

  return (
    <SectionSkeleton
      section="goals"
      summary={
        <section class="tile is-band section-lead">
          <h3 class="section-lead-question">What can be handed off, and what verified it</h3>
          {presentation.summaryRefusal === null ? (
            <div class="section-lead-body">
              {/* A goal is not resolved by anything on this page. What the lead states is how many
                  have a verified outcome behind them, which is a different number from how many
                  exist and is the only one that means the loop closed. The two stats beside it are
                  the rest of the same partition, so the three always add up to the total. */}
              <p class="section-lead-answer">
                <span class="section-lead-figure">{formatInteger(validated)}</span>
                <span>
                  {` of ${formatInteger(goals.length)} ${goals.length === 1 ? 'job' : 'jobs'} handed off ${validated === 1 ? 'has' : 'have'} been checked and confirmed. ${
                    validated === goals.length
                      ? 'Each one was decided by running its own scenario again.'
                      : checkedNotConfirmed > 0
                        ? 'The rest were checked and the check did not confirm them.'
                        : 'The rest are written up and waiting on the command that decides them.'
                  }`}
                </span>
              </p>
              <div class="section-lead-aside">
                <StatRow>
                  <RuledStat
                    value={formatInteger(checkedNotConfirmed)}
                    label="Checked, not confirmed"
                    basis="observed"
                    nil={checkedNotConfirmed === 0}
                  />
                  <RuledStat
                    value={formatInteger(neverChecked)}
                    label="Never checked"
                    basis="discovered"
                    nil={neverChecked === 0}
                  />
                </StatRow>
              </div>
            </div>
          ) : (
            <RefusalPanel
              title={presentation.summaryRefusal.title}
              commands={presentation.summaryRefusal.commands}
            >
              <p>{presentation.summaryRefusal.reason}</p>
            </RefusalPanel>
          )}
        </section>
      }
      primary={
        <section class="tile">
          <Eyebrow level={3} count={goals.length}>
            Everything handed off
          </Eyebrow>
          {presentation.primaryRefusal === null ? (
            <ul class="plain small">
              {goals.map((goal) => (
                <li key={goal.id}>
                  <span class="mono">{goal.id}</span>
                  <span>{` ${goal.title}`}</span>
                  <Meta>
                    <span>{humanise(goal.status)}</span>
                    <span>{`${formatInteger(goal.acceptanceCriteria.length)} things that have to be true`}</span>
                    <span>
                      {judgements.has(goal.id) ? 'checked in this report' : 'not checked yet'}
                    </span>
                  </Meta>
                </li>
              ))}
            </ul>
          ) : (
            <RefusalPanel
              title={presentation.primaryRefusal.title}
              commands={presentation.primaryRefusal.commands}
            >
              <p>{presentation.primaryRefusal.reason}</p>
            </RefusalPanel>
          )}
        </section>
      }
      detail={
        presentation.detailRefusal === null ? (
          goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              highlighted={goal.id === highlighted}
              judgement={judgements.get(goal.id) ?? null}
            />
          ))
        ) : (
          <section class="tile">
            <Eyebrow level={3}>What each job asks for</Eyebrow>
            <RefusalPanel
              title={presentation.detailRefusal.title}
              commands={presentation.detailRefusal.commands}
            >
              <p>{presentation.detailRefusal.reason}</p>
            </RefusalPanel>
          </section>
        )
      }
    />
  );
}
