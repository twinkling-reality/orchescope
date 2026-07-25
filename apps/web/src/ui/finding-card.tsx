/**
 * One finding, with its evidence and its actions.
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
  formatInteger,
  formatMetricValue,
  formatSourceLocation,
  formatTimestamp,
  humanise,
} from '../format.ts';
import { componentLabel, type GraphIndex } from '../graph-index.ts';
import { useApp } from '../store.tsx';
import { CapabilityAction, CopyButton } from './actions.tsx';
import {
  BasisBadge,
  Callout,
  Chip,
  Confidence,
  DefinitionList,
  SectionHeading,
  SeverityBadge,
} from './atoms.tsx';
import { EvidenceList, OpenLocationAction } from './evidence-list.tsx';

function Metrics(props: { readonly finding: Finding }) {
  if (props.finding.metrics.length === 0) {
    return null;
  }
  return (
    <section>
      <SectionHeading title="Measurements" />
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
              <td>{formatMetricValue(metric.value, metric.unit)}</td>
              <td>
                {metric.comparisonValue === undefined ? (
                  <span class="muted">not compared</span>
                ) : (
                  formatMetricValue(metric.comparisonValue, metric.unit)
                )}
              </td>
              <td>{formatInteger(metric.sampleSize)}</td>
              <td>
                <BasisBadge basis={metric.basis} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <SectionHeading title="Affected components" count={props.finding.components.length} />
      <ul class="plain inline-list">
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
            <span class="mono muted">{componentId}</span>
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
      <SectionHeading title="Recommendation" />
      <p>{recommendation.summary}</p>
      {recommendation.steps.length === 0 ? null : (
        <ol class="steps">
          {recommendation.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      <p class="muted">
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
      <SectionHeading title="Suggested experiment" />
      <p>{experiment.description}</p>
      <pre class="command">{formatArgv(experiment.command)}</pre>
      <p class="muted">{`Expected signal: ${experiment.expectedSignal}`}</p>
      {experiment.scenarioId === undefined ? null : (
        <p class="muted mono">{`Scenario: ${experiment.scenarioId}`}</p>
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
          <p class="action-result good">
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
  const [expanded, setExpanded] = useState(props.open);
  return (
    <article class={`finding finding-${finding.polarity}`} id={`finding-${finding.id}`}>
      {/* Title, then what it means, then the classification. A reader deciding whether to care needs the
          first two; the identifier, the basis and the confidence are what they check once they do. */}
      <header class="finding-head">
        <div class="finding-title">
          <SeverityBadge severity={finding.severity} />
          <h3>{finding.title}</h3>
        </div>
      </header>

      <p class="finding-explanation">{finding.explanation}</p>
      <p class="finding-impact">
        <strong>Impact. </strong>
        {finding.impact}
      </p>

      <div class="finding-meta">
        <span class="mono">{finding.id}</span>
        <Chip label={humanise(finding.category)} title={`Category: ${finding.category}`} />
        <Chip
          label={finding.polarity === 'strength' ? 'strength' : 'risk'}
          tone={finding.polarity === 'strength' ? 'good' : 'bad'}
        />
        <BasisBadge basis={finding.basis} />
        <Confidence value={finding.confidence} />
      </div>

      <button
        type="button"
        class="button subtle"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded(!expanded);
        }}
      >
        {expanded ? 'Hide evidence and actions' : 'Show evidence and actions'}
      </button>

      {expanded ? (
        <div class="finding-body fade-in">
          <Metrics finding={finding} />
          <AffectedComponents finding={finding} index={props.index} />
          {finding.sourceLocations.length === 0 ? null : (
            <section>
              <SectionHeading title="Source locations" count={finding.sourceLocations.length} />
              <ul class="plain">
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
            <SectionHeading title="Evidence" count={finding.evidence.length} />
            <EvidenceList evidenceIds={finding.evidence} index={props.index} />
          </section>
          <Recommendation finding={finding} />
          <Experiment finding={finding} />
          <section>
            <SectionHeading title="Classification" />
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
                { label: 'Rule', value: finding.ruleId, code: true },
                { label: 'Recorded', value: formatTimestamp(finding.createdAt) },
                {
                  label: 'Goal readiness',
                  value: `${finding.goalReadiness.eligible ? 'eligible' : 'not eligible'}: ${finding.goalReadiness.reason}`,
                },
              ]}
            />
            {finding.conflictsWith.length === 0 ? null : (
              <Callout
                tone="warn"
                title={`This finding conflicts with ${finding.conflictsWith.join(', ')}, and both are kept.`}
              />
            )}
          </section>
          <Actions finding={finding} index={props.index} />
        </div>
      ) : null}
    </article>
  );
}
