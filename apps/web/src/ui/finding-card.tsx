/**
 * One finding: a line, expanding to its evidence and its actions.
 *
 * The collapsed line carries what a reader scanning a list decides on: the severity, the claim, how
 * many evidence records stand behind it, the class of that evidence and the confidence. Everything a
 * reader argues with is one click away rather than on the page at all times.
 *
 * Every action that needs the local server is gated on the capability the bundle declares for it, and
 * the two that do not need a server, copying the finding and reading it, always work.
 */

import type { Finding } from '@orchescope/schema';
import { useState } from 'preact/hooks';
import {
  type CreateComparisonRequest,
  type CreateGoalRequest,
  ENDPOINTS,
  parseCreateComparison,
  parseCreateGoal,
  parseRerunScenario,
  type RerunScenarioRequest,
} from '../api.ts';
import { postJson } from '../client.tsx';
import { buildFindingText } from '../finding-text.ts';
import {
  formatArgv,
  formatConfidence,
  formatInteger,
  formatMetricValue,
  formatSourceLocation,
  formatTimestamp,
  humanise,
} from '../format.ts';
import { componentLabel, type GraphIndex } from '../graph-index.ts';
import { useApp } from '../store.tsx';
import { CapabilityAction, CopyButton } from './actions.tsx';
import { EvidenceList, OpenLocationAction } from './evidence-list.tsx';
import {
  BasisChip,
  Data,
  DefinitionList,
  DisclosureRow,
  Eyebrow,
  Meta,
  RefusalPanel,
  SeverityMark,
} from './primitives.tsx';

function Metrics(props: { readonly finding: Finding }) {
  if (props.finding.metrics.length === 0) {
    return null;
  }
  return (
    <section>
      <Eyebrow level={4}>Measurements</Eyebrow>
      <div class="scroll-x">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Value</th>
              <th scope="col">Compared with</th>
              <th scope="col">Sample size</th>
              <th scope="col">Evidence class</th>
            </tr>
          </thead>
          <tbody>
            {props.finding.metrics.map((metric) => (
              <tr key={metric.name}>
                <th scope="row">{metric.name}</th>
                <td class="num">{formatMetricValue(metric.value, metric.unit)}</td>
                <td class="num">
                  {metric.comparisonValue === undefined
                    ? 'not compared'
                    : formatMetricValue(metric.comparisonValue, metric.unit)}
                </td>
                <td class="num">{formatInteger(metric.sampleSize)}</td>
                <td>
                  <BasisChip basis={metric.basis} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AffectedComponents(props: { readonly finding: Finding; readonly index: GraphIndex }) {
  const app = useApp();
  if (props.finding.components.length === 0) {
    return null;
  }
  return (
    <section>
      <Eyebrow level={4} count={props.finding.components.length}>
        Affected components
      </Eyebrow>
      <ul class="plain inline-list small">
        {props.finding.components.map((componentId) => (
          <li key={componentId}>
            <button
              type="button"
              class="link-button"
              title={`Select ${componentId} on the system map`}
              onClick={() => {
                app.selectComponent(componentId, { goToMap: true });
              }}
            >
              {componentLabel(props.index, componentId)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recommendation(props: { readonly finding: Finding }) {
  const recommendation = props.finding.recommendation;
  if (recommendation === undefined) {
    return null;
  }
  return (
    <section>
      <Eyebrow level={4}>Recommendation</Eyebrow>
      <p>{recommendation.summary}</p>
      {recommendation.steps.length === 0 ? null : (
        <ol class="steps">
          {recommendation.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      <p class="note">
        {`Effort ${recommendation.effort} and change risk ${recommendation.risk}. Both are design judgements rather than measurements.`}
      </p>
    </section>
  );
}

function Experiment(props: { readonly finding: Finding }) {
  const experiment = props.finding.suggestedExperiment;
  if (experiment === undefined) {
    return null;
  }
  return (
    <section>
      <Eyebrow level={4}>Suggested experiment</Eyebrow>
      <p>{experiment.description}</p>
      <pre class="command">{formatArgv(experiment.command)}</pre>
      <p class="note">{`Expected signal: ${experiment.expectedSignal}`}</p>
      {experiment.scenarioId === undefined ? null : (
        <Meta>
          <span>{`Scenario ${experiment.scenarioId}`}</span>
        </Meta>
      )}
    </section>
  );
}

function Actions(props: { readonly finding: Finding; readonly index: GraphIndex }) {
  const app = useApp();
  const [goalId, setGoalId] = useState<string | null>(null);
  const scenarioId = props.finding.suggestedExperiment?.scenarioId ?? null;
  const goalBody: CreateGoalRequest = { findingId: props.finding.id };
  const comparisonBody: CreateComparisonRequest = {
    findingId: props.finding.id,
    ...(scenarioId === null ? {} : { scenarioId }),
  };

  return (
    <div class="actions">
      <CopyButton
        label="Copy finding"
        announcement={`finding ${props.finding.id}`}
        text={buildFindingText(props.finding, (componentId) =>
          componentLabel(props.index, componentId),
        )}
      />
      <CapabilityAction
        capability="create_goal"
        label="Create goal"
        hint="Ask the local server to turn this finding into an improvement goal"
        run={async () => {
          const result = await postJson(ENDPOINTS.goals, goalBody, parseCreateGoal);
          if (!result.ok) {
            return { ok: false, message: result.message };
          }
          setGoalId(result.value.goalId);
          return { ok: true, message: `Created goal ${result.value.goalId}.` };
        }}
      >
        {goalId === null ? null : (
          <p class="action-result">
            <button
              type="button"
              class="link-button"
              onClick={() => {
                app.navigate('goals', { goal: goalId });
              }}
            >
              {`Open ${goalId} in the goals section`}
            </button>
          </p>
        )}
      </CapabilityAction>
      {scenarioId === null ? null : (
        <CapabilityAction
          capability="rerun_scenario"
          label="Rerun relevant test"
          hint={`Ask the local server to rerun scenario ${scenarioId}`}
          run={async () => {
            const body: RerunScenarioRequest = { scenarioId };
            const result = await postJson(ENDPOINTS.scenarioRuns, body, parseRerunScenario);
            return result.ok
              ? {
                  ok: true,
                  message: `Started run ${result.value.runId}${result.value.status === null ? '' : ` (${result.value.status})`}. Regenerate the report to see it.`,
                }
              : { ok: false, message: result.message };
          }}
        />
      )}
      <CapabilityAction
        capability="compare_runs"
        label="Compare with baseline"
        hint="Ask the local server to compare the latest run against the recorded baseline"
        run={async () => {
          const result = await postJson(
            ENDPOINTS.comparisons,
            comparisonBody,
            parseCreateComparison,
          );
          return result.ok
            ? {
                ok: true,
                message: `Created comparison ${result.value.comparisonId}${result.value.verdict === null ? '' : `: ${result.value.verdict}`}.`,
              }
            : { ok: false, message: result.message };
        }}
      />
      {props.finding.sourceLocations[0] === undefined ? null : (
        <OpenLocationAction
          file={props.finding.sourceLocations[0].file}
          line={props.finding.sourceLocations[0].startLine}
        />
      )}
    </div>
  );
}

export function FindingCard(props: {
  readonly finding: Finding;
  readonly index: GraphIndex;
  readonly open: boolean;
}) {
  const { finding } = props;
  return (
    <article class="finding" id={`finding-${finding.id}`}>
      <DisclosureRow
        open={props.open}
        lead={<SeverityMark severity={finding.severity} />}
        title={finding.title}
        meta={
          <>
            <Data>{formatInteger(finding.evidence.length)}</Data>
            {' evidence · '}
            <BasisChip basis={finding.basis} />
            {' · '}
            <Data title="Confidence in this claim, from 0 to 1.">
              {formatConfidence(finding.confidence)}
            </Data>
          </>
        }
      >
        <p>{finding.explanation}</p>
        <p>
          <strong>Impact. </strong>
          {finding.impact}
        </p>
        <Meta>
          <span>{finding.id}</span>
          <span>{humanise(finding.category)}</span>
          <span>{finding.polarity === 'strength' ? 'strength' : 'risk'}</span>
          <span>{finding.ruleId}</span>
        </Meta>

        <Metrics finding={finding} />
        <AffectedComponents finding={finding} index={props.index} />

        {finding.sourceLocations.length === 0 ? null : (
          <section>
            <Eyebrow level={4} count={finding.sourceLocations.length}>
              Source locations
            </Eyebrow>
            <ul class="plain small">
              {finding.sourceLocations.map((location) => (
                <li class="location" key={`${location.file}:${location.startLine}`}>
                  <span class="mono">
                    {formatSourceLocation(location.file, location.startLine, location.endLine)}
                  </span>
                  <OpenLocationAction file={location.file} line={location.startLine} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <Eyebrow level={4} count={finding.evidence.length}>
            Evidence
          </Eyebrow>
          <EvidenceList evidenceIds={finding.evidence} index={props.index} />
        </section>

        <Recommendation finding={finding} />
        <Experiment finding={finding} />

        <section>
          <Eyebrow level={4}>Classification</Eyebrow>
          <DefinitionList
            rows={[
              {
                label: 'Taxonomy',
                value:
                  finding.taxonomy.length === 0
                    ? 'no unambiguous mapping'
                    : finding.taxonomy.join(', '),
                code: finding.taxonomy.length > 0,
              },
              {
                label: 'Tags',
                value: finding.tags.length === 0 ? 'none' : finding.tags.join(', '),
              },
              { label: 'Recorded', value: formatTimestamp(finding.createdAt) },
              {
                label: 'Goal readiness',
                value: `${finding.goalReadiness.eligible ? 'eligible' : 'not eligible'}: ${finding.goalReadiness.reason}`,
              },
            ]}
          />
          {finding.conflictsWith.length === 0 ? null : (
            <RefusalPanel
              title={`This finding conflicts with ${finding.conflictsWith.join(', ')}, and both are kept.`}
            >
              <p>
                Two rules reached claims that cannot both be right. Neither is withdrawn, because
                discarding one would be choosing between them without evidence.
              </p>
            </RefusalPanel>
          )}
        </section>

        <Actions finding={finding} index={props.index} />
      </DisclosureRow>
    </article>
  );
}
