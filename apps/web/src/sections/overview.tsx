/**
 * The overview leads with the reconciliation delta, because the delta between what a repository declares
 * and what a run exercises is the one thing neither a static scanner nor a tracing tool can compute
 * alone. Coverage limits sit on the same page: a report that does not say what it failed to inspect is
 * not evidence.
 */

import { basisDescriptors, SEVERITY_ORDER } from '../basis.ts';
import { orderedCapabilities } from '../capabilities.ts';
import { reportCommand, scanCommand, traceCommand } from '../commands.ts';
import { groupByReason } from '../filters.ts';
import {
  formatBytes,
  formatDuration,
  formatInteger,
  formatPercent,
  formatTimestamp,
  humanise,
} from '../format.ts';
import { useApp } from '../store.tsx';
import {
  BooleanValue,
  Callout,
  Chip,
  CommandBlock,
  DefinitionList,
  SectionHeading,
} from '../ui/atoms.tsx';

function Stat(props: { readonly label: string; readonly value: string; readonly note?: string }) {
  return (
    <div class="stat">
      <p class="stat-value">{props.value}</p>
      <p class="stat-label">{props.label}</p>
      {props.note === undefined ? null : <p class="stat-note muted">{props.note}</p>}
    </div>
  );
}

function Reconciliation() {
  const app = useApp();
  const delta = app.bundle.reconciliation;
  if (delta === undefined) {
    return (
      <section class="panel">
        <SectionHeading title="Declared against exercised" />
        <Callout tone="info" title="No run has been ingested, so there is no delta to report.">
          <p>
            The delta compares what the repository declares with what an execution actually reaches.
            It needs at least one run. Wrap the system once and regenerate the report.
          </p>
          <CommandBlock argv={traceCommand()} />
          <CommandBlock argv={reportCommand()} />
        </Callout>
      </section>
    );
  }
  const { coverage } = delta;
  return (
    <section class="panel">
      <SectionHeading
        title="Declared against exercised"
        note="What the repository declares, measured against what the ingested runs actually reached."
      />
      <div class="stats">
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
      <DefinitionList
        rows={[
          {
            label: 'Component exercise rate',
            value:
              coverage.componentExerciseRate === undefined
                ? 'not computable without runs'
                : `${formatPercent(coverage.componentExerciseRate)} (${formatInteger(coverage.exercisedComponents)} of ${formatInteger(coverage.declaredComponents)})`,
          },
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
      {delta.contradictions.length === 0 ? null : (
        <div class="subpanel">
          <SectionHeading
            title="Contradictions"
            count={delta.contradictions.length}
            note="A declaration that an observation disagrees with. Neither side is assumed to be right."
          />
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
      )}
      {delta.duplicateSideEffects.length === 0 ? null : (
        <div class="subpanel">
          <SectionHeading
            title="Duplicate side effects"
            count={delta.duplicateSideEffects.length}
          />
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
      )}
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
        note="Everything the scan could not read or could not model, so the report is not mistaken for a complete one."
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

      <div class="subpanel">
        <SectionHeading title="Skipped files by reason" count={coverage.skipped.length} />
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
      </div>

      <div class="subpanel">
        <SectionHeading title="Areas Orchescope cannot model" count={coverage.unsupported.length} />
        {coverage.unsupported.length === 0 ? (
          <p class="muted">Nothing was recorded as unsupported.</p>
        ) : (
          <ul class="plain">
            {coverage.unsupported.map((area) => (
              <li key={area.area}>
                <strong>{area.area}</strong>
                <p class="muted">{area.reason}</p>
                {area.remediation === undefined ? null : <p>{area.remediation}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="subpanel">
        <SectionHeading title="Adapters that ran" count={coverage.adapters.length} />
        {coverage.adapters.length === 0 ? (
          <p class="muted">No adapter run was recorded.</p>
        ) : (
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
        )}
      </div>

      {coverage.languages.length === 0 ? null : (
        <div class="subpanel">
          <SectionHeading title="Languages seen" count={coverage.languages.length} />
          <ul class="plain inline-list">
            {coverage.languages.map((language) => (
              <li key={language.language}>
                <Chip label={`${language.language}: ${formatInteger(language.fileCount)}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Capabilities() {
  const app = useApp();
  const capabilities = orderedCapabilities(app.capabilities);
  if (capabilities.length === 0) {
    return null;
  }
  return (
    <section class="panel">
      <SectionHeading
        title="What this report can do from here"
        note="Actions this page offers, and the reason for each one that is unavailable."
      />
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
    </section>
  );
}

function EvidenceLegend() {
  return (
    <section class="panel">
      <SectionHeading
        title="Evidence classes used in this report"
        note="Every value on every page carries one of these. They are not interchangeable."
      />
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
    </section>
  );
}

export function OverviewSection() {
  const app = useApp();
  const { bundle } = app;
  const summary = bundle.summary;
  const severities = SEVERITY_ORDER.filter(
    (severity) => (summary.findingCountBySeverity[severity] ?? 0) > 0,
  );
  const unknownSeverities = Object.keys(summary.findingCountBySeverity).filter(
    (severity) => !SEVERITY_ORDER.includes(severity as (typeof SEVERITY_ORDER)[number]),
  );

  return (
    <div class="section">
      <section class="panel">
        <h2>{bundle.projectName}</h2>
        <DefinitionList
          rows={[
            { label: 'Report', value: bundle.reportId, code: true },
            { label: 'Generated', value: formatTimestamp(bundle.generatedAt) },
            { label: 'Graph', value: bundle.graph.graphId, code: true },
            { label: 'Scan', value: bundle.graph.provenance.scanId, code: true },
            {
              label: 'Orchescope version',
              value: bundle.graph.provenance.orchescopeVersion,
              code: true,
            },
            {
              label: 'Revision',
              value:
                bundle.graph.provenance.git === undefined
                  ? 'not a git working tree, or git was unavailable'
                  : `${bundle.graph.provenance.git.ref ?? 'unknown ref'} ${bundle.graph.provenance.git.commit ?? ''} ${bundle.graph.provenance.git.dirty ? '(working tree dirty)' : '(working tree clean)'}`,
            },
            { label: 'Schema version', value: String(bundle.schemaVersion) },
          ]}
        />
        <div class="stats">
          <Stat label="Components" value={formatInteger(summary.componentCount)} />
          <Stat label="Relations" value={formatInteger(summary.edgeCount)} />
          <Stat label="Seen at runtime" value={formatInteger(summary.observedComponentCount)} />
          <Stat
            label="Source only"
            value={formatInteger(summary.staticOnlyComponentCount)}
            note="declared but not observed"
          />
          <Stat
            label="Runtime only"
            value={formatInteger(summary.runtimeOnlyComponentCount)}
            note="observed but not declared"
          />
          <Stat label="Runs" value={formatInteger(summary.runCount)} />
          <Stat label="Scenarios" value={formatInteger(summary.scenarioCount)} />
          <Stat label="Strengths" value={formatInteger(summary.strengthCount)} />
        </div>
      </section>

      <Reconciliation />

      <section class="panel">
        <SectionHeading title="Findings by severity" count={bundle.findings.length} />
        {bundle.findings.length === 0 ? (
          <p class="muted">
            This report contains no findings. That is a statement about the rules that ran, not a
            guarantee about the system.
          </p>
        ) : (
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
                  {`${humanise(severity)}: ${formatInteger(summary.findingCountBySeverity[severity] ?? 0)}`}
                </button>
              </li>
            ))}
            {unknownSeverities.map((severity) => (
              <li key={severity}>
                {`${severity}: ${formatInteger(summary.findingCountBySeverity[severity] ?? 0)}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Coverage />
      <Capabilities />
      <EvidenceLegend />

      {bundle.graph.provenance.runIds.length === 0 ? (
        <section class="panel">
          <Callout tone="info" title="No runtime evidence is folded into this graph.">
            <p>Scan and report produce the declared side. A run produces the exercised side.</p>
            <CommandBlock argv={scanCommand()} />
            <CommandBlock argv={traceCommand()} />
          </Callout>
        </section>
      ) : null}
    </div>
  );
}
