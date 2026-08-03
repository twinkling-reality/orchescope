/**
 * Improvement goals, rendered in full.
 *
 * The three exports here work with no server at all: an agent prompt, the goal as JSON and the goal as
 * Markdown. That is deliberate, because the hand off from a report to whoever implements the change is
 * the point of the document and must not depend on a process still running.
 */

import type { Goal, GoalValidationSummary } from '@orchescope/schema';
import { goalCommand } from '../commands.ts';
import { formatArgv, formatInteger, formatTimestamp, humanise } from '../format.ts';
import { findingForGoal } from '../goal-finding.ts';
import { componentLabel } from '../graph-index.ts';
import {
  buildAgentPrompt,
  describeAcceptanceCheck,
  goalToJson,
  goalToMarkdown,
} from '../prompt.ts';
import { useApp } from '../store.tsx';
import { CopyButton, DownloadButton } from '../ui/actions.tsx';
import { EvidenceList, OpenLocationAction } from '../ui/evidence-list.tsx';
import { BasisChip, Data, DefinitionList, Eyebrow, Meta, RefusalPanel } from '../ui/primitives.tsx';

function StringList(props: {
  readonly title: string;
  readonly items: readonly string[];
  readonly empty: string;
  readonly mono?: boolean;
}) {
  return (
    <div class="group">
      <Eyebrow level={4} count={props.items.length}>
        {props.title}
      </Eyebrow>
      {props.items.length === 0 ? (
        <p class="note">{props.empty}</p>
      ) : (
        <ul class={props.mono === true ? 'plain mono small' : 'plain small'}>
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The word for what a criterion decided.
 *
 * A criterion the evidence could not decide is not a failure, and calling it one would be the report
 * asserting an outcome it does not have. The three states are words rather than marks because the two
 * alert hues belong to severity and nothing else.
 */
const outcomeState = (outcome: GoalValidationSummary['outcomes'][number]): string =>
  !outcome.decided ? 'undecided' : outcome.satisfied ? 'satisfied' : 'not satisfied';

/**
 * One goal is one bento.
 *
 * The band is the contract: which goal, what problem it was created from, and what this report
 * decided about it. The anchor is the acceptance criteria, because the criteria are the only thing
 * here that decides anything, and a goal whose criteria are undecided is not a goal that failed. The
 * stage is the validation plan, which is the commands whoever implements the change actually runs.
 * The stack carries the evidence the goal rests on and the three exports, which work with no server.
 *
 * The scope, the source locations, the evidence records and the rollback are behind the stack's `···`.
 * They are the terms of the contract rather than the argument, and a reader looks them up.
 */
function GoalCard(props: {
  readonly goal: Goal;
  readonly highlighted: boolean;
  readonly judgement: GoalValidationSummary | null;
}) {
  const app = useApp();
  const { goal, judgement } = props;
  const source = findingForGoal(goal, app.bundle.findings);
  const outcomes = new Map(
    (judgement?.outcomes ?? []).map((outcome) => [outcome.criterionId, outcome]),
  );
  return (
    <div class="bento" id={`goal-${goal.id}`}>
      <section class="tile is-band">
        <Eyebrow>{goal.id}</Eyebrow>
        <h3>{goal.title}</h3>
        <div class="lead-head is-prose">
          <div>
            <p class="lede">{goal.problemStatement}</p>
            {source === null ? (
              <p class="note">
                The finding this goal was created from is not in this report, which is what a
                resolved finding looks like. The acceptance criteria beside it are what decide
                whether it was resolved.
              </p>
            ) : (
              <p class="more">
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    app.navigate('findings', { finding: source.id });
                  }}
                >
                  {`From finding ${source.id}`}
                </button>
              </p>
            )}
            {goal.expectedImprovement === undefined ? null : (
              <p class="note">{`Expected improvement: ${goal.expectedImprovement}`}</p>
            )}
          </div>
          <div class="lead-measure">
            <DefinitionList
              rows={[
                { label: 'Status', value: humanise(goal.status) },
                { label: 'Risk', value: goal.risk },
                {
                  label: 'Acceptance criteria',
                  value: <Data>{formatInteger(goal.acceptanceCriteria.length)}</Data>,
                },
                {
                  label: 'Affected components',
                  value: <Data>{formatInteger(goal.affectedComponents.length)}</Data>,
                },
                { label: 'Created', value: formatTimestamp(goal.createdAt) },
                { label: 'Updated', value: formatTimestamp(goal.updatedAt) },
              ]}
            />
          </div>
        </div>
      </section>

      <section class="tile is-anchor">
        <div class="tile-head">
          <Eyebrow level={3} count={goal.acceptanceCriteria.length}>
            Acceptance criteria
          </Eyebrow>
        </div>
        <div class="tile-body">
          {judgement === null ? (
            <RefusalPanel title="This report did not judge this goal.">
              <p>
                The criteria below were not evaluated when this report was generated, so nothing
                here says whether the change worked. A criterion the evidence could not decide says
                undecided rather than failed.
              </p>
            </RefusalPanel>
          ) : (
            <p class="lede">{`${judgement.summary}.`}</p>
          )}
          <ul class="plain small">
            {goal.acceptanceCriteria.map((criterion) => {
              const outcome = outcomes.get(criterion.id) ?? null;
              return (
                <li key={criterion.id}>
                  <span class="mono">{criterion.id}</span>
                  <span>{` ${criterion.statement}`}</span>
                  {outcome === null ? (
                    <p class="muted">{`Checked by: ${describeAcceptanceCheck(criterion.check)}`}</p>
                  ) : (
                    <>
                      <Meta>
                        <span>{outcomeState(outcome)}</span>
                        <span>{describeAcceptanceCheck(criterion.check)}</span>
                      </Meta>
                      <p class="muted">{outcome.detail}</p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section class="tile is-stage">
        <div class="tile-head">
          <Eyebrow level={3}>Validation plan</Eyebrow>
        </div>
        <div class="tile-body">
          <DefinitionList
            rows={[
              {
                label: 'Repetitions',
                value: <Data>{formatInteger(goal.validation.repetitions)}</Data>,
              },
              {
                label: 'Executes the system',
                value: goal.validation.requiresExecution ? 'yes' : 'no, analysis only',
              },
              {
                label: 'Scenarios to rerun',
                value: goal.validation.scenarioIds.join(', ') || 'none',
                code: goal.validation.scenarioIds.length > 0,
              },
              {
                label: 'Baseline runs',
                value: goal.validation.baselineRunIds.join(', ') || 'none',
                code: goal.validation.baselineRunIds.length > 0,
              },
              ...(goal.validation.baselineBenchmarkId === undefined
                ? []
                : [
                    {
                      label: 'Baseline benchmark',
                      value: goal.validation.baselineBenchmarkId,
                      code: true,
                    },
                  ]),
            ]}
          />
          <div class="group">
            <Eyebrow level={4} count={goal.validation.commands.length}>
              Commands that decide it
            </Eyebrow>
            <ul class="plain">
              {goal.validation.commands.map((entry) => (
                // Keyed by the command, not the purpose: two scenarios named by one goal are rerun
                // for the same reason and carry the same sentence.
                <li key={formatArgv(entry.command)}>
                  <p class="small">{entry.purpose}</p>
                  <pre class="command">{formatArgv(entry.command)}</pre>
                </li>
              ))}
            </ul>
          </div>
          {goal.validationResults.length === 0 ? null : (
            <div class="group">
              <Eyebrow level={4} count={goal.validationResults.length}>
                Comparisons that judged this goal
              </Eyebrow>
              <ul class="plain small">
                {goal.validationResults.map((result) => (
                  <li key={result.comparisonId}>
                    <span class="mono">{result.comparisonId}</span>
                    <span>{` ${result.verdict} `}</span>
                    <span class="muted">{formatTimestamp(result.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <div class="tile-stack">
        <section class="tile">
          <div class="tile-head">
            <Eyebrow level={3} count={goal.evidenceSummary.length}>
              Evidence summary
            </Eyebrow>
          </div>
          <div class="tile-body">
            {goal.evidenceSummary.length === 0 ? (
              <p class="note">No evidence summary was recorded.</p>
            ) : (
              <ul class="plain small">
                {goal.evidenceSummary.map((entry) => (
                  <li key={`${entry.label}:${entry.value}`}>
                    <span>{entry.label}</span>
                    <Data>{` ${entry.value} `}</Data>
                    <BasisChip basis={entry.basis} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <details class="tile-more" open={props.highlighted}>
            <summary>
              <span class="visually-hidden">
                The scope of this goal, its source locations, its evidence records and its rollback
              </span>
              <span aria-hidden="true">···</span>
            </summary>
            <div class="tile-more-body">
              <StringList
                title="Allowed write paths"
                items={goal.scope.allowedWritePaths}
                empty="No write path is allowed, which makes this goal unimplementable as written."
                mono
              />
              <StringList
                title="Prohibited changes"
                items={goal.scope.prohibitedChanges}
                empty="No prohibition was recorded."
              />
              <StringList
                title="Invariants"
                items={goal.scope.invariants}
                empty="No invariant was recorded."
              />
              <StringList
                title="Approvals required"
                items={goal.scope.requiredApprovals.map(humanise)}
                empty="No approval is required before this change may be merged."
              />
              <div class="group">
                <Eyebrow level={4} count={goal.affectedComponents.length}>
                  Affected components
                </Eyebrow>
                <ul class="plain inline-list small">
                  {goal.affectedComponents.map((componentId) => (
                    <li key={componentId}>
                      <button
                        type="button"
                        class="link-button"
                        onClick={() => {
                          app.selectComponent(componentId, { goToMap: true });
                        }}
                      >
                        {componentLabel(app.index, componentId)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div class="group">
                <Eyebrow level={4} count={goal.sourceLocations.length}>
                  Source locations
                </Eyebrow>
                {goal.sourceLocations.length === 0 ? (
                  <p class="note">No source location was recorded.</p>
                ) : (
                  <ul class="plain small">
                    {goal.sourceLocations.map((location) => (
                      <li class="location" key={`${location.file}:${location.startLine}`}>
                        <span class="mono">{`${location.file}:${location.startLine}`}</span>
                        <OpenLocationAction file={location.file} line={location.startLine} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div class="group">
                <Eyebrow level={4} count={goal.evidence.length}>
                  Evidence records
                </Eyebrow>
                <EvidenceList evidenceIds={goal.evidence} index={app.index} />
              </div>
              <div class="group">
                <Eyebrow level={4}>Rollback</Eyebrow>
                <p class="small">{goal.rollback}</p>
              </div>
            </div>
          </details>
        </section>

        <section class="tile">
          <div class="tile-head">
            <Eyebrow level={3}>Hand off</Eyebrow>
          </div>
          <div class="tile-body">
            <p class="lede">
              All three work with no server running, because the hand off from a report to whoever
              implements the change must not depend on a process still being up.
            </p>
            <div class="actions">
              <CopyButton
                label="Copy agent prompt"
                announcement={`the agent prompt for ${goal.id}`}
                text={buildAgentPrompt(goal)}
              />
              <DownloadButton
                label="Export goal as JSON"
                filename={`${goal.id}.json`}
                mediaType="application/json"
                text={goalToJson(goal)}
              />
              <DownloadButton
                label="Export as Markdown"
                filename={`${goal.id}.md`}
                mediaType="text/markdown"
                text={goalToMarkdown(goal)}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function GoalsSection() {
  const app = useApp();
  const { goals } = app.bundle;
  const highlighted = app.state.route.params['goal'] ?? null;

  if (goals.length === 0) {
    const eligible = app.bundle.findings.find((finding) => finding.goalReadiness.eligible) ?? null;
    return (
      <div class="bento">
        <section class="tile is-band">
          <Eyebrow level={3}>Goals</Eyebrow>
          <RefusalPanel
            title="No goal has been created, so no finding here has become work anyone can verify."
            commands={[goalCommand(eligible?.id ?? null)]}
          >
            <p>
              A goal is the bounded contract between a finding and whoever implements the change:
              the write scope, the prohibitions, the acceptance criteria and the exact validation
              command.
              {eligible === null
                ? ' No finding in this report is marked eligible for one yet.'
                : ` ${eligible.id} is marked eligible.`}
            </p>
          </RefusalPanel>
        </section>
      </div>
    );
  }

  const judgements = new Map(
    (app.bundle.goalValidations ?? []).map((entry) => [entry.goalId, entry]),
  );
  return (
    <>
      {goals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          highlighted={goal.id === highlighted}
          judgement={judgements.get(goal.id) ?? null}
        />
      ))}
    </>
  );
}
