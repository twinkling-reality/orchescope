/**
 * The overview answers three questions in order: what is the delta between what this repository declares and
 * what a run exercised, what are the worst things found, and what should the reader do next.
 *
 * Everything else on this page is secondary and collapsed: identifiers, adapter runs, the evidence legend and
 * the capability table are all things a reader looks up rather than reads. Coverage limits are not collapsed
 * away entirely, because a report that does not say what it failed to inspect is not evidence, so the counts
 * stay visible and only their tables fold.
 */

import { basisDescriptors, SEVERITY_ORDER } from '../basis.ts';
import { orderedCapabilities } from '../capabilities.ts';
import { auditCommand, importTraceCommand, traceCommand } from '../commands.ts';
import { groupByReason, sortFindings } from '../filters.ts';
import { formatBytes, formatDuration, formatInteger, formatPercent, humanise } from '../format.ts';
import { failedAdapters, nextActions } from '../next-actions.ts';
import { useApp } from '../store.tsx';
import {
  BooleanValue,
  Callout,
  Chip,
  CommandBlock,
  DefinitionList,
  Disclosure,
  SectionHeading,
  SeverityBadge,
} from '../ui/atoms.tsx';

const TOP_RISK_COUNT = 3;

function Stat(props: { readonly label: string; readonly value: string; readonly note?: string }) {
  return (
    <div class="stat">
      <p class="stat-value">{props.value}</p>
      <p class="stat-label">{props.label}</p>
      {props.note === undefined ? null : <p class="stat-note muted">{props.note}</p>}
    </div>
  );
}

/**
 * The revision this scan read, which is the one piece of provenance a reader needs in order to trust the
 * page. The report identifier, the scan identifier and the schema version are already in the page chrome, so
 * they are not repeated here: the disclosure exists for the identifiers that are not shown anywhere else.
 */
function ScanContext() {
  const app = useApp();
  const { bundle } = app;
  const git = bundle.graph.provenance.git;
  return (
    <div class="report-meta">
      <p class="muted">
        {git === undefined
          ? 'Not a git working tree, or git was unavailable, so no revision is recorded for this scan.'
          : `Read at ${git.ref ?? 'an unknown ref'} ${git.commit ?? ''} ${git.dirty ? '(working tree dirty, so the graph may not match any commit)' : '(working tree clean)'}`}
      </p>
      <Disclosure summary="Identifiers">
        <DefinitionList
          rows={[
            { label: 'Graph', value: bundle.graph.graphId, code: true },
            { label: 'Project', value: bundle.graph.provenance.projectId, code: true },
            {
              label: 'Runs folded in',
              value:
                bundle.graph.provenance.runIds.length === 0
                  ? 'none'
                  : bundle.graph.provenance.runIds.join(', '),
              code: bundle.graph.provenance.runIds.length > 0,
            },
          ]}
        />
      </Disclosure>
    </div>
  );
}

/** An input the project wrote and Orchescope could not use. Never collapsed: it changes what this report means. */
function InputProblems() {
  const app = useApp();
  const failed = failedAdapters(app.bundle);
  if (failed.length === 0) {
    return null;
  }
  return (
    <Callout
      tone="bad"
      title="An input this repository wrote on purpose could not be read, so what it declared is missing here."
    >
      <ul class="plain">
        {failed.map((adapter) => (
          <li key={adapter.id}>
            <strong>{adapter.id}</strong>
            <span>{`: ${adapter.detail}`}</span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

function Reconciliation() {
  const app = useApp();
  const delta = app.bundle.reconciliation;
  if (delta === undefined) {
    return (
      <section class="panel highlighted">
        <SectionHeading
          title="Declared against exercised"
          note="This report has the declared side only."
        />
        <Callout tone="info" title="Static only. No run has been ingested, so there is no delta.">
          <p>
            The delta compares what the repository declares with what an execution actually reaches.
            It needs at least one run. Wrap the system once, or import spans you already have, then
            audit again.
          </p>
          <CommandBlock argv={traceCommand()} />
          <CommandBlock argv={importTraceCommand()} />
          <CommandBlock argv={auditCommand()} />
        </Callout>
      </section>
    );
  }
  const { coverage } = delta;
  return (
    <section class="panel highlighted">
      <SectionHeading
        title="Declared against exercised"
        note="What the repository declares, measured against what the ingested runs actually reached."
      />
      <div class="stats">
        <Stat
          label="Components exercised"
          value={
            coverage.componentExerciseRate === undefined
              ? 'not computable'
              : formatPercent(coverage.componentExerciseRate)
          }
          note={`${formatInteger(coverage.exercisedComponents)} of ${formatInteger(coverage.declaredComponents)} declared`}
        />
        <Stat
          label="Declared, never exercised"
          value={formatInteger(delta.declaredNotExercised.components.length)}
          note={`${formatInteger(delta.declaredNotExercised.edges.length)} relations too`}
        />
        <Stat
          label="Exercised, never declared"
          value={formatInteger(delta.exercisedNotDeclared.components.length)}
          note={`${formatInteger(delta.exercisedNotDeclared.edges.length)} relations too`}
        />
        <Stat
          label="Contradictions"
          value={formatInteger(delta.contradictions.length)}
          note="declaration against observation"
        />
        <Stat
          label="Duplicate side effects"
          value={formatInteger(delta.duplicateSideEffects.length)}
          note="same logical operation, more than once"
        />
      </div>

      {delta.contradictions.length === 0 ? null : (
        <div class="subpanel">
          <SectionHeading
            title="Contradictions"
            count={delta.contradictions.length}
            note="A declaration that an observation disagrees with. Neither side is assumed to be right."
          />
          <div class="scroll-x">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Declared</th>
                  <th scope="col">Observed</th>
                </tr>
              </thead>
              <tbody>
                {delta.contradictions.map((contradiction) => (
                  <tr key={`${contradiction.componentId}:${contradiction.kind}`}>
                    <th scope="row">
                      <button
                        type="button"
                        class="link-button"
                        onClick={() => {
                          app.selectComponent(contradiction.componentId, { goToMap: true });
                        }}
                      >
                        {contradiction.componentId}
                      </button>
                    </th>
                    <td>{humanise(contradiction.kind)}</td>
                    <td>{contradiction.declared}</td>
                    <td>{contradiction.observed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {delta.duplicateSideEffects.length === 0 ? null : (
        <div class="subpanel">
          <SectionHeading
            title="Duplicate side effects"
            count={delta.duplicateSideEffects.length}
          />
          <div class="scroll-x">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Operation</th>
                  <th scope="col">Component</th>
                  <th scope="col">Occurrences</th>
                  <th scope="col">Retry attempts</th>
                  <th scope="col">Idempotency key</th>
                </tr>
              </thead>
              <tbody>
                {delta.duplicateSideEffects.map((duplicate) => (
                  <tr key={duplicate.key}>
                    <th scope="row" class="mono">
                      {duplicate.key}
                    </th>
                    <td>{duplicate.componentId ?? 'not attributed'}</td>
                    <td>{formatInteger(duplicate.occurrences)}</td>
                    <td>
                      {duplicate.retryAttempts.length === 0
                        ? 'none recorded'
                        : duplicate.retryAttempts.join(', ')}
                    </td>
                    <td>
                      <BooleanValue
                        value={duplicate.idempotencyKeyPresent}
                        trueLabel="present"
                        falseLabel="absent"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Disclosure summary="How the delta was computed">
        <DefinitionList
          rows={[
            {
              label: 'Relation exercise rate',
              value:
                coverage.edgeExerciseRate === undefined
                  ? 'not computable without runs'
                  : `${formatPercent(coverage.edgeExerciseRate)} (${formatInteger(coverage.exercisedEdges)} of ${formatInteger(coverage.declaredEdges)})`,
            },
            {
              label: 'Runs considered',
              value:
                delta.declaredNotExercised.runIds.length === 0
                  ? 'none recorded'
                  : delta.declaredNotExercised.runIds.join(', '),
              code: delta.declaredNotExercised.runIds.length > 0,
            },
            {
              label: 'Static side read at',
              value:
                delta.revision === undefined
                  ? 'not recorded'
                  : `${delta.revision.ref ?? 'unknown ref'} ${delta.revision.commit ?? ''} ${delta.revision.dirty ? '(working tree dirty)' : '(working tree clean)'}`,
            },
          ]}
        />
      </Disclosure>
    </section>
  );
}

/** The worst findings, by severity then confidence. Title and impact only: the rest is in the findings section. */
function TopRisks() {
  const app = useApp();
  const { bundle } = app;
  const risks = sortFindings(bundle.findings.filter((finding) => finding.polarity === 'risk'));
  const severities = SEVERITY_ORDER.filter(
    (severity) => (bundle.summary.findingCountBySeverity[severity] ?? 0) > 0,
  );

  if (risks.length === 0) {
    return (
      <section class="panel">
        <SectionHeading title="Top risks" />
        <p class="muted">
          No risk was reported. That is a statement about the rules that had enough evidence to
          fire, not a guarantee about the system.
        </p>
        {bundle.summary.strengthCount === 0 ? null : (
          <p>
            <button
              type="button"
              class="link-button"
              onClick={() => {
                app.navigate('findings');
              }}
            >
              {`${formatInteger(bundle.summary.strengthCount)} strength(s) recorded, in the findings section`}
            </button>
          </p>
        )}
      </section>
    );
  }

  return (
    <section class="panel">
      <SectionHeading
        title="Top risks"
        note={`The ${Math.min(TOP_RISK_COUNT, risks.length)} highest of ${formatInteger(risks.length)}, by severity then confidence. Each one carries its evidence in the findings section.`}
      />
      <ul class="plain risk-list">
        {risks.slice(0, TOP_RISK_COUNT).map((finding) => (
          <li class="risk" key={finding.id}>
            <p class="risk-head">
              <SeverityBadge severity={finding.severity} />
              <button
                type="button"
                class="link-button risk-title"
                onClick={() => {
                  app.navigate('findings', { finding: finding.id });
                }}
              >
                {finding.title}
              </button>
            </p>
            <p class="risk-impact">{finding.impact}</p>
          </li>
        ))}
      </ul>
      <ul class="plain inline-list severity-counts">
        {severities.map((severity) => (
          <li key={severity}>
            <button
              type="button"
              class="link-button"
              onClick={() => {
                app.navigate('findings', { severity });
              }}
            >
              {`${humanise(severity)}: ${formatInteger(bundle.summary.findingCountBySeverity[severity] ?? 0)}`}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            class="link-button"
            onClick={() => {
              app.navigate('findings');
            }}
          >
            {`all ${formatInteger(bundle.findings.length)} findings`}
          </button>
        </li>
      </ul>
    </section>
  );
}

function NextSteps() {
  const app = useApp();
  const actions = nextActions(app.bundle);
  if (actions.length === 0) {
    return null;
  }
  return (
    <section class="panel">
      <SectionHeading
        title="What to do next"
        note="Derived from this report. Each step produces evidence the next one needs."
      />
      <ol class="next-actions">
        {actions.map((action) => (
          <li class="next-action" key={action.title}>
            <p class="next-action-title">{action.title}</p>
            <p class="muted">{action.reason}</p>
            {action.commands.map((argv) => (
              <CommandBlock key={argv.join(' ')} argv={argv} />
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Coverage() {
  const app = useApp();
  const coverage = app.bundle.graph.coverage;
  const skipped = groupByReason(
    coverage.skipped.map((entry) => ({ reason: entry.reason, file: entry.file })),
  );
  return (
    <section class="panel">
      <SectionHeading
        title="What could not be inspected"
        note="Everything the scan could not read or could not model, so this report is not mistaken for a complete one."
      />
      <div class="stats">
        <Stat label="Files discovered" value={formatInteger(coverage.filesDiscovered)} />
        <Stat
          label="Files parsed"
          value={formatInteger(coverage.filesParsed)}
          note={formatBytes(coverage.bytesParsed)}
        />
        <Stat label="Files skipped" value={formatInteger(coverage.skipped.length)} />
        <Stat label="Scan duration" value={formatDuration(coverage.durationMs)} />
      </div>
      {coverage.truncated ? (
        <Callout
          tone="warn"
          title="The scan was cut short by a deadline or a resource limit, so this graph is partial."
        />
      ) : null}

      {coverage.unsupported.length === 0 ? null : (
        <div class="subpanel">
          <SectionHeading
            title="Areas Orchescope cannot model"
            count={coverage.unsupported.length}
          />
          <ul class="plain">
            {coverage.unsupported.map((area) => (
              <li key={area.area}>
                <strong>{area.area}</strong>
                <p class="muted">{area.reason}</p>
                {area.remediation === undefined ? null : <p>{area.remediation}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Disclosure summary="Skipped files by reason" count={coverage.skipped.length}>
        {skipped.length === 0 ? (
          <p class="muted">No file was skipped.</p>
        ) : (
          <ul class="plain">
            {skipped.map((group) => (
              <li key={group.reason}>
                <strong>{humanise(group.reason)}</strong>
                <span class="chip chip-neutral">{formatInteger(group.count)}</span>
                <span class="muted mono">{group.examples.join(', ')}</span>
                {group.count > group.examples.length ? (
                  <span class="muted">{` and ${formatInteger(group.count - group.examples.length)} more`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Disclosure>

      <Disclosure summary="Adapters that ran" count={coverage.adapters.length}>
        {coverage.adapters.length === 0 ? (
          <p class="muted">No adapter run was recorded.</p>
        ) : (
          <div class="scroll-x">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Adapter</th>
                  <th scope="col">Ecosystem</th>
                  <th scope="col">Status</th>
                  <th scope="col">Components</th>
                  <th scope="col">Relations</th>
                  <th scope="col">Files</th>
                  <th scope="col">Duration</th>
                </tr>
              </thead>
              <tbody>
                {coverage.adapters.map((adapter) => (
                  <tr key={`${adapter.adapterId}@${adapter.adapterVersion}`}>
                    <th scope="row" class="mono">
                      {`${adapter.adapterId} ${adapter.adapterVersion}`}
                    </th>
                    <td>{humanise(adapter.ecosystem)}</td>
                    <td>
                      <Chip
                        label={humanise(adapter.status)}
                        tone={
                          adapter.status === 'failed'
                            ? 'bad'
                            : adapter.status === 'completed'
                              ? 'good'
                              : 'neutral'
                        }
                        title={adapter.detail ?? humanise(adapter.status)}
                      />
                    </td>
                    <td>{formatInteger(adapter.componentsFound)}</td>
                    <td>{formatInteger(adapter.edgesFound)}</td>
                    <td>{formatInteger(adapter.filesInspected)}</td>
                    <td>{formatDuration(adapter.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Disclosure>

      {coverage.languages.length === 0 ? null : (
        <Disclosure summary="Languages seen" count={coverage.languages.length}>
          <ul class="plain inline-list">
            {coverage.languages.map((language) => (
              <li key={language.language}>
                <Chip label={`${language.language}: ${formatInteger(language.fileCount)}`} />
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

function Reference() {
  const app = useApp();
  const capabilities = orderedCapabilities(app.capabilities);
  return (
    <section class="panel">
      <SectionHeading
        title="Reference"
        note="Looked up rather than read: what every evidence class means, and which actions this page can perform."
      />
      <Disclosure summary="Evidence classes used in this report">
        <dl class="definitions">
          {basisDescriptors().map((descriptor) => (
            <div class="definition" key={descriptor.value}>
              <dt>
                <span class={`badge basis basis-${descriptor.value}`}>
                  <span class="badge-marker" aria-hidden="true">
                    {descriptor.marker}
                  </span>
                  <span class="badge-label">{descriptor.label}</span>
                </span>
              </dt>
              <dd>{descriptor.meaning}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
      {capabilities.length === 0 ? null : (
        <Disclosure
          summary="What this report can do from here"
          count={capabilities.length}
          note="Actions this page offers, and the reason for each one that is unavailable."
        >
          <div class="scroll-x">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Available</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {capabilities.map((capability) => (
                  <tr key={capability.name}>
                    <th scope="row">{humanise(capability.name)}</th>
                    <td>
                      <BooleanValue value={capability.available} />
                    </td>
                    <td>{capability.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}
    </section>
  );
}

export function OverviewSection() {
  const app = useApp();
  const { bundle } = app;
  const summary = bundle.summary;
  const unknownSeverities = Object.keys(summary.findingCountBySeverity).filter(
    (severity) => !SEVERITY_ORDER.includes(severity as (typeof SEVERITY_ORDER)[number]),
  );

  return (
    <div class="section">
      <section class="panel">
        <SectionHeading
          title="What was found"
          note="The shape of the system this scan read, before any judgement about it."
        />
        <ScanContext />
        <InputProblems />
        <div class="stats">
          <Stat
            label="Components"
            value={formatInteger(summary.componentCount)}
            note={`${formatInteger(summary.edgeCount)} relations`}
          />
          <Stat
            label="Seen at runtime"
            value={formatInteger(summary.observedComponentCount)}
            note={`${formatInteger(summary.runtimeOnlyComponentCount)} never declared`}
          />
          <Stat
            label="Source only"
            value={formatInteger(summary.staticOnlyComponentCount)}
            note="declared but not observed"
          />
          <Stat
            label="Runs"
            value={formatInteger(summary.runCount)}
            note={`${formatInteger(summary.scenarioCount)} scenarios`}
          />
        </div>
        {unknownSeverities.length === 0 ? null : (
          <p class="muted">
            {`This report also counts findings at ${unknownSeverities.join(', ')}, which this page does not rank.`}
          </p>
        )}
      </section>

      <Reconciliation />
      <TopRisks />
      <NextSteps />
      <Coverage />
      <Reference />
    </div>
  );
}
