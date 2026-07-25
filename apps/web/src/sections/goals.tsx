/**
 * Improvement goals, rendered in full.
 *
 * The three exports here work with no server at all: an agent prompt, the goal as JSON and the goal as
 * Markdown. That is deliberate, because the hand off from a report to whoever implements the change is
 * the point of the document and must not depend on a process still running.
 */

import type { Goal } from '@orchescope/schema';
import { goalCommand } from '../commands.ts';
import { formatArgv, formatInteger, formatTimestamp, humanise } from '../format.ts';
import { componentLabel } from '../graph-index.ts';
import {
  buildAgentPrompt,
  describeAcceptanceCheck,
  goalToJson,
  goalToMarkdown,
} from '../prompt.ts';
import { useApp } from '../store.tsx';
import { CopyButton, DownloadButton } from '../ui/actions.tsx';
import { BasisBadge, Chip, DefinitionList, EmptyState, SectionHeading } from '../ui/atoms.tsx';
import { EvidenceList, OpenLocationAction } from '../ui/evidence-list.tsx';

function statusTone(status: Goal['status']): 'good' | 'bad' | 'warn' | 'neutral' {
  if (status === 'validated') {
    return 'good';
  }
  if (status === 'rejected' || status === 'abandoned') {
    return 'bad';
  }
  if (status === 'in_progress' || status === 'ready') {
    return 'warn';
  }
  return 'neutral';
}

function StringList(props: {
  readonly title: string;
  readonly items: readonly string[];
  readonly empty: string;
  readonly mono?: boolean;
}) {
  return (
    <div class="subpanel">
      <SectionHeading title={props.title} count={props.items.length} />
      {props.items.length === 0 ? (
        <p class="muted">{props.empty}</p>
      ) : (
        <ul class={props.mono === true ? 'plain mono' : 'plain'}>
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GoalCard(props: { readonly goal: Goal; readonly highlighted: boolean }) {
  const app = useApp();
  const { goal } = props;
  return (
    <section class={props.highlighted ? 'panel highlighted' : 'panel'} id={`goal-${goal.id}`}>
      <SectionHeading title={`${goal.id} ${goal.title}`} />
      <div class="chip-row">
        <Chip label={humanise(goal.status)} tone={statusTone(goal.status)} />
        <Chip
          label={`risk ${goal.risk}`}
          tone={goal.risk === 'high' ? 'bad' : goal.risk === 'medium' ? 'warn' : 'neutral'}
        />
        <button
          type="button"
          class="link-button"
          onClick={() => {
            app.navigate('findings', { finding: goal.findingId });
          }}
        >
          {`from finding ${goal.findingId}`}
        </button>
      </div>

      <DefinitionList
        rows={[
          { label: 'Created', value: formatTimestamp(goal.createdAt) },
          { label: 'Updated', value: formatTimestamp(goal.updatedAt) },
          ...(goal.expectedImprovement === undefined
            ? []
            : [{ label: 'Expected improvement', value: goal.expectedImprovement }]),
        ]}
      />

      <div class="subpanel">
        <SectionHeading title="Problem" />
        <p>{goal.problemStatement}</p>
      </div>

      <div class="subpanel">
        <SectionHeading title="Evidence summary" count={goal.evidenceSummary.length} />
        {goal.evidenceSummary.length === 0 ? (
          <p class="muted">No evidence summary was recorded.</p>
        ) : (
          <ul class="plain">
            {goal.evidenceSummary.map((entry) => (
              <li key={`${entry.label}:${entry.value}`}>
                <strong>{entry.label}</strong>
                <span>{` ${entry.value} `}</span>
                <BasisBadge basis={entry.basis} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="subpanel">
        <SectionHeading title="Evidence records" count={goal.evidence.length} />
        <EvidenceList evidenceIds={goal.evidence} index={app.index} />
      </div>

      <div class="subpanel">
        <SectionHeading title="Affected components" count={goal.affectedComponents.length} />
        <ul class="plain inline-list">
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
              <span class="mono muted">{componentId}</span>
            </li>
          ))}
        </ul>
      </div>

      <div class="subpanel">
        <SectionHeading title="Source locations" count={goal.sourceLocations.length} />
        {goal.sourceLocations.length === 0 ? (
          <p class="muted">No source location was recorded.</p>
        ) : (
          <ul class="plain">
            {goal.sourceLocations.map((location) => (
              <li class="location" key={`${location.file}:${location.startLine}`}>
                <span class="mono">{`${location.file}:${location.startLine}`}</span>
                <OpenLocationAction file={location.file} line={location.startLine} />
              </li>
            ))}
          </ul>
        )}
      </div>

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

      <div class="subpanel">
        <SectionHeading title="Acceptance criteria" count={goal.acceptanceCriteria.length} />
        <ul class="plain">
          {goal.acceptanceCriteria.map((criterion) => (
            <li key={criterion.id}>
              <strong>{criterion.id}</strong>
              <span>{` ${criterion.statement}`}</span>
              <p class="muted">{`Checked by: ${describeAcceptanceCheck(criterion.check)}`}</p>
            </li>
          ))}
        </ul>
      </div>

      <div class="subpanel">
        <SectionHeading title="Validation plan" />
        <DefinitionList
          rows={[
            { label: 'Repetitions', value: formatInteger(goal.validation.repetitions) },
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
        <ul class="plain">
          {goal.validation.commands.map((entry) => (
            <li key={entry.purpose}>
              <p>{entry.purpose}</p>
              <pre class="command">{formatArgv(entry.command)}</pre>
            </li>
          ))}
        </ul>
      </div>

      <div class="subpanel">
        <SectionHeading title="Rollback" />
        <p>{goal.rollback}</p>
      </div>

      {goal.validationResults.length === 0 ? null : (
        <div class="subpanel">
          <SectionHeading title="Validation results" count={goal.validationResults.length} />
          <ul class="plain">
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
    </section>
  );
}

export function GoalsSection() {
  const app = useApp();
  const { goals } = app.bundle;
  const highlighted = app.state.route.params['goal'] ?? null;

  if (goals.length === 0) {
    const eligible = app.bundle.findings.find((finding) => finding.goalReadiness.eligible) ?? null;
    return (
      <div class="section">
        <section class="panel">
          <EmptyState
            title="No goals yet"
            body="A goal is the bounded contract between a finding and whoever implements the change: the write scope, the prohibitions, the acceptance criteria and the exact validation command. Create one from a finding that is marked eligible."
            commands={[goalCommand(eligible?.id ?? null)]}
          />
        </section>
      </div>
    );
  }

  return (
    <div class="section">
      {goals.map((goal) => (
        <GoalCard key={goal.id} goal={goal} highlighted={goal.id === highlighted} />
      ))}
    </div>
  );
}
