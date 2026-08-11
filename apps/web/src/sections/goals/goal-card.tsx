import type { Goal, GoalValidationSummary } from '@orchescope/schema';
import { formatArgv, formatInteger, formatTimestamp, humanise } from '../../presentation/format.ts';
import { findingForGoal } from '../../presentation/goal-finding.ts';
import { componentLabel } from '../../presentation/graph-index.ts';
import {
  buildAgentPrompt,
  describeAcceptanceCheck,
  goalToJson,
  goalToMarkdown,
} from '../../presentation/prompt.ts';
import { useApp } from '../../store.tsx';
import { CopyButton, DownloadButton } from '../../ui/actions.tsx';
import { EvidenceList, OpenLocationAction } from '../../ui/evidence-list.tsx';
import {
  BasisChip,
  Data,
  DefinitionList,
  Eyebrow,
  Meta,
  RefusalPanel,
} from '../../ui/primitives.tsx';

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

const outcomeState = (outcome: GoalValidationSummary['outcomes'][number]): string =>
  !outcome.decided ? 'undecided' : outcome.satisfied ? 'satisfied' : 'not satisfied';

export function GoalCard(props: {
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
      <section class="tile">
        <Eyebrow>{goal.id}</Eyebrow>
        <h3>{goal.title}</h3>
        <div class="lead-head is-prose">
          <div>
            <p class="lede">{goal.problemStatement}</p>
            {source === null ? (
              <p class="note">
                The problem this came from is not in this report any more, which is what a fixed
                problem looks like. What decides whether it really was fixed is the list beside
                this.
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
                  {`From problem ${source.id}`}
                </button>
              </p>
            )}
            {goal.expectedImprovement === undefined ? null : (
              <p class="note">{`What it should improve: ${goal.expectedImprovement}`}</p>
            )}
          </div>
          <div class="lead-measure">
            <DefinitionList
              rows={[
                { label: 'Where it stands', value: humanise(goal.status) },
                { label: 'How risky the change is', value: goal.risk },
                {
                  label: 'Things that have to be true',
                  value: <Data>{formatInteger(goal.acceptanceCriteria.length)}</Data>,
                },
                {
                  label: 'Parts it touches',
                  value: <Data>{formatInteger(goal.affectedComponents.length)}</Data>,
                },
                { label: 'Written', value: formatTimestamp(goal.createdAt) },
                { label: 'Last changed', value: formatTimestamp(goal.updatedAt) },
              ]}
            />
          </div>
        </div>
      </section>

      <section class="tile is-anchor">
        <div class="tile-head">
          <Eyebrow level={3} count={goal.acceptanceCriteria.length}>
            What has to be true before this counts as done
          </Eyebrow>
        </div>
        <div class="tile-body">
          {judgement === null ? (
            <RefusalPanel title="This report has not checked this one.">
              <p>
                Nothing below was checked when this report was made, so nothing here says whether
                the change worked. Anything the evidence could not settle says undecided rather than
                failed.
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
                    <p class="muted">{`How it gets checked: ${describeAcceptanceCheck(criterion.check)}`}</p>
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
          <Eyebrow level={3}>How anyone will know it worked</Eyebrow>
        </div>
        <div class="tile-body">
          <DefinitionList
            rows={[
              {
                label: 'How many times to run it',
                value: <Data>{formatInteger(goal.validation.repetitions)}</Data>,
              },
              {
                label: 'Does it actually run the system',
                value: goal.validation.requiresExecution ? 'yes' : 'no, it only reads the code',
              },
              {
                label: 'Scenarios to run again',
                value: goal.validation.scenarioIds.join(', ') || 'none',
                code: goal.validation.scenarioIds.length > 0,
              },
              {
                label: 'Runs to compare against',
                value: goal.validation.baselineRunIds.join(', ') || 'none',
                code: goal.validation.baselineRunIds.length > 0,
              },
              ...(goal.validation.baselineBenchmarkId === undefined
                ? []
                : [
                    {
                      label: 'Measurements to compare against',
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
                Times this was checked
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
              What this rests on
            </Eyebrow>
          </div>
          <div class="tile-body">
            {goal.evidenceSummary.length === 0 ? (
              <p class="note">Nothing was recorded here.</p>
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
                What the change may touch, where in the code, what it rests on and how to undo it
              </span>
              <span aria-hidden="true">···</span>
            </summary>
            <div class="tile-more-body">
              <StringList
                title="Files the change may touch"
                items={goal.scope.allowedWritePaths}
                empty="Nothing may be touched, which makes this impossible to do as written."
                mono
              />
              <StringList
                title="Things it must not do"
                items={goal.scope.prohibitedChanges}
                empty="Nothing was ruled out."
              />
              <StringList
                title="Things that must stay true"
                items={goal.scope.invariants}
                empty="Nothing was recorded here."
              />
              <StringList
                title="Who has to sign it off"
                items={goal.scope.requiredApprovals.map(humanise)}
                empty="Nobody has to sign this off before it goes in."
              />
              <div class="group">
                <Eyebrow level={4} count={goal.affectedComponents.length}>
                  Parts it touches
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
                  Where in the code
                </Eyebrow>
                {goal.sourceLocations.length === 0 ? (
                  <p class="note">Nowhere in the code was recorded.</p>
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
                  The evidence itself
                </Eyebrow>
                <EvidenceList evidenceIds={goal.evidence} index={app.index} />
              </div>
              <div class="group">
                <Eyebrow level={4}>How to undo it</Eyebrow>
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
              All three work with nothing running, because handing this to whoever makes the change
              must not depend on a process still being up.
            </p>
            <div class="actions">
              <CopyButton
                label="Copy the instructions"
                announcement={`the agent prompt for ${goal.id}`}
                text={buildAgentPrompt(goal)}
              />
              <DownloadButton
                label="Download it as JSON"
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
