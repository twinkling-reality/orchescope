/**
 * The details panel for one component: what it is, where it was found, what it is connected to, what it
 * cost, what it is allowed to do and what the report says about it.
 */

import type { Component, Edge, EdgePolicy } from '@orchescope/schema';
import {
  formatDuration,
  formatInteger,
  formatSourceLocation,
  formatUsd,
  humanise,
} from '../format.ts';
import type { GraphIndex } from '../graph-index.ts';
import { useApp } from '../store.tsx';
import {
  BasisBadge,
  Callout,
  Chip,
  Confidence,
  DefinitionList,
  type DefinitionRow,
  OptionalNumber,
  SafeLink,
  SectionHeading,
  SeverityBadge,
} from './atoms.tsx';
import { OpenLocationAction } from './evidence-list.tsx';

function describePolicy(policy: EdgePolicy | undefined): string {
  if (policy === undefined) {
    return 'no reliability policy recorded';
  }
  const parts: string[] = [];
  if (policy.timeoutMs !== undefined) {
    parts.push(`timeout ${formatDuration(policy.timeoutMs)}`);
  }
  if (policy.retry !== undefined) {
    const attempts =
      policy.retry.maxAttempts === undefined
        ? 'no attempt ceiling'
        : `${policy.retry.maxAttempts} attempts`;
    parts.push(
      `retry ${attempts}, ${policy.retry.bounded ? 'bounded' : 'unbounded'}, ${policy.retry.backoff} backoff, idempotency ${policy.retry.idempotency}`,
    );
  }
  if (policy.concurrency !== undefined) {
    parts.push(`concurrency ${policy.concurrency}`);
  }
  if (policy.requiresApproval !== undefined) {
    parts.push(policy.requiresApproval ? 'requires approval' : 'no approval required');
  }
  return parts.length === 0 ? 'no reliability policy recorded' : parts.join('; ');
}

function EdgeRow(props: {
  readonly edge: Edge;
  readonly otherId: string;
  readonly index: GraphIndex;
  readonly direction: 'out' | 'in';
}) {
  const app = useApp();
  const other = props.index.componentsById.get(props.otherId);
  const observation = props.edge.observation;
  return (
    <li class="edge-row">
      <div class="edge-head">
        <Chip label={humanise(props.edge.kind)} title={`Relation kind: ${props.edge.kind}`} />
        <span aria-hidden="true">{props.direction === 'out' ? '→' : '←'}</span>
        <button
          type="button"
          class="link-button"
          onClick={() => {
            app.selectComponent(props.otherId);
          }}
        >
          {other?.displayName ?? props.otherId}
        </button>
        <BasisBadge basis={props.edge.basis} />
        {props.edge.runtimeOnly ? (
          <Chip
            label="runtime only"
            tone="warn"
            title="This relation appears only in traces and is absent from the static model."
          />
        ) : null}
      </div>
      <p class="muted">{describePolicy(props.edge.policy)}</p>
      {observation === undefined ? (
        <p class="muted">Never observed in a run.</p>
      ) : (
        <p class="muted">
          {`${formatInteger(observation.executionCount)} executions, ${formatInteger(observation.errorCount)} errors, ${formatInteger(observation.retryCount)} retries, ${formatDuration(observation.totalDurationMs)} total`}
        </p>
      )}
    </li>
  );
}

function renderDetailValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return String(value);
}

/** Keys whose value is an address supplied by the analysed project, so it is never trusted as a link. */
const URL_KEYS: ReadonlySet<string> = new Set(['url']);

function DetailFields(props: { readonly component: Component }) {
  const details = props.component.details;
  if (details === undefined) {
    return null;
  }
  const rows: DefinitionRow[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === 'for' || value === undefined || value === null) {
      continue;
    }
    const rendered = renderDetailValue(value);
    rows.push({
      label: humanise(key),
      value: URL_KEYS.has(key) ? <SafeLink href={rendered}>{rendered}</SafeLink> : rendered,
      code: true,
    });
  }
  if (rows.length === 0) {
    return null;
  }
  return (
    <section>
      <SectionHeading title={`${humanise(props.component.kind)} configuration`} />
      <DefinitionList rows={rows} />
    </section>
  );
}

function Locations(props: { readonly component: Component }) {
  const { sourceLocations, configLocations } = props.component;
  return (
    <section>
      <SectionHeading title="Where it was found" />
      {sourceLocations.length === 0 && configLocations.length === 0 ? (
        <p class="muted">No source or configuration location was recorded for this component.</p>
      ) : null}
      <ul class="plain">
        {sourceLocations.map((location) => (
          <li class="location" key={`${location.file}:${location.startLine}`}>
            <span class="mono">
              {formatSourceLocation(location.file, location.startLine, location.endLine)}
            </span>
            <OpenLocationAction
              file={location.file}
              line={location.startLine}
              {...(location.startColumn === undefined ? {} : { column: location.startColumn })}
            />
          </li>
        ))}
        {configLocations.map((location) => (
          <li class="location" key={`${location.file}${location.pointer}`}>
            <span class="mono">{`${location.file}${location.pointer}`}</span>
            <OpenLocationAction file={location.file} line={1} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Permissions(props: { readonly component: Component }) {
  return (
    <section>
      <SectionHeading title="Permissions" count={props.component.permissions.length} />
      {props.component.permissions.length === 0 ? (
        <p class="muted">
          No permission was discovered for this component. That is not proof it has none.
        </p>
      ) : (
        <ul class="plain">
          {props.component.permissions.map((permission) => (
            <li key={`${permission.kind}:${permission.scope}:${permission.mode}`}>
              <Chip label={humanise(permission.kind)} />
              <span class="mono">{permission.scope}</span>
              <Chip
                label={permission.mode}
                tone={permission.mode === 'read' ? 'neutral' : 'warn'}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metrics(props: { readonly componentId: string; readonly index: GraphIndex }) {
  const metrics = props.index.metricsByComponent.get(props.componentId);
  if (metrics === undefined) {
    return (
      <section>
        <SectionHeading title="Measured cost" />
        <p class="muted">
          {props.index.hasRuntimeEvidence
            ? 'This component produced no runtime measurements in the ingested runs.'
            : 'This report contains no runs, so nothing about this component was measured.'}
        </p>
      </section>
    );
  }
  return (
    <section>
      <SectionHeading title="Measured cost" note="Observed in the runs folded into this report." />
      <DefinitionList
        rows={[
          { label: 'Executions', value: formatInteger(metrics.executionCount) },
          { label: 'Self time', value: formatDuration(metrics.selfDurationMs) },
          { label: 'Total time', value: formatDuration(metrics.totalDurationMs) },
          {
            label: 'p95 duration',
            value: <OptionalNumber value={metrics.p95DurationMs ?? null} render={formatDuration} />,
          },
          { label: 'Input tokens', value: formatInteger(metrics.inputTokens) },
          { label: 'Output tokens', value: formatInteger(metrics.outputTokens) },
          {
            label: 'Cost',
            value: <OptionalNumber value={metrics.costUsd ?? null} render={formatUsd} />,
          },
          { label: 'Errors', value: formatInteger(metrics.errorCount) },
          { label: 'Retries', value: formatInteger(metrics.retryCount) },
        ]}
      />
    </section>
  );
}

function RelatedFindings(props: { readonly componentId: string; readonly index: GraphIndex }) {
  const app = useApp();
  const findings = props.index.findingsByComponent.get(props.componentId) ?? [];
  return (
    <section>
      <SectionHeading title="Findings naming this component" count={findings.length} />
      {findings.length === 0 ? (
        <p class="muted">No finding names this component.</p>
      ) : (
        <ul class="plain">
          {findings.map((finding) => (
            <li class="finding-link" key={finding.id}>
              <SeverityBadge severity={finding.severity} />
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  app.navigate('findings', { finding: finding.id });
                }}
              >
                {`${finding.id} ${finding.title}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {findings.some((finding) => finding.suggestedExperiment !== undefined) ? (
        <div class="experiments">
          <SectionHeading title="Experiments those findings suggest" />
          <ul class="plain">
            {findings
              .filter((finding) => finding.suggestedExperiment !== undefined)
              .map((finding) => (
                <li key={finding.id}>
                  <p>{finding.suggestedExperiment?.description}</p>
                  <pre class="command">
                    {(finding.suggestedExperiment?.command ?? []).join(' ')}
                  </pre>
                  <p class="muted">{`Expected signal: ${finding.suggestedExperiment?.expectedSignal ?? ''}`}</p>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Scenarios(props: { readonly componentId: string; readonly index: GraphIndex }) {
  const ids = props.index.scenarioIdsByComponent.get(props.componentId) ?? [];
  return (
    <section>
      <SectionHeading
        title="Scenarios it appeared in"
        count={ids.length}
        note="Derived from the runs whose evidence names this component."
      />
      {ids.length === 0 ? (
        <p class="muted">No ingested run produced evidence naming this component.</p>
      ) : (
        <ul class="plain">
          {ids.map((id) => (
            <li key={id}>
              <span class="mono">{id}</span>{' '}
              <span class="muted">
                {props.index.scenariosById.get(id)?.name ?? 'not defined in this bundle'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ComponentDetails(props: {
  readonly componentId: string;
  readonly index: GraphIndex;
}) {
  const component = props.index.componentsById.get(props.componentId);
  if (component === undefined) {
    return (
      <Callout tone="warn" title="That component is not in this report.">
        <p class="mono">{props.componentId}</p>
      </Callout>
    );
  }
  const outgoing = props.index.outgoing.get(component.id) ?? [];
  const incoming = props.index.incoming.get(component.id) ?? [];

  return (
    <div class="details fade-in">
      <header class="details-head">
        <h2>{component.displayName}</h2>
        <div class="details-tags">
          <Chip label={humanise(component.kind)} title={`Component kind: ${component.kind}`} />
          <BasisBadge basis={component.basis} />
          <Confidence value={component.confidence} />
          {props.index.runtimeOnly.has(component.id) ? (
            <Chip
              label="runtime only"
              tone="warn"
              title="Observed in a trace and absent from the static model."
            />
          ) : null}
          {props.index.neverExercised.has(component.id) ? (
            <Chip
              label="never exercised"
              tone="warn"
              title="Declared in the repository and not seen in any ingested run."
            />
          ) : null}
        </div>
        <p class="mono muted">{component.id}</p>
      </header>

      {component.description === undefined ? null : (
        <p class="details-description">{component.description}</p>
      )}

      <DefinitionList
        rows={[
          {
            label: 'Identity',
            value: `${component.identity.namespace} / ${component.identity.localName}`,
            code: true,
          },
          {
            label: 'Presence',
            value:
              [
                component.presence.static ? 'in source or configuration' : null,
                component.presence.manifest ? 'in a manifest' : null,
                component.presence.runtime ? 'in a runtime trace' : null,
              ]
                .filter((part) => part !== null)
                .join(', ') || 'not recorded',
          },
          {
            label: 'Side effect class',
            value:
              component.sideEffect === undefined
                ? 'not classified'
                : humanise(component.sideEffect),
          },
          { label: 'Discovered by', value: component.discoveredBy.join(', '), code: true },
          { label: 'Fingerprint', value: component.fingerprint, code: true },
          ...(component.tags.length === 0
            ? []
            : [{ label: 'Tags', value: component.tags.join(', ') }]),
          ...(component.aliases.length === 0
            ? []
            : [
                {
                  label: 'Aliases',
                  value: component.aliases
                    .map(
                      (alias) =>
                        `${alias.identity.namespace}/${alias.identity.localName} (${alias.reason})`,
                    )
                    .join('; '),
                  code: true,
                },
              ]),
        ]}
      />

      <DetailFields component={component} />
      <Locations component={component} />

      <section>
        <SectionHeading title="Outgoing relations" count={outgoing.length} />
        {outgoing.length === 0 ? (
          <p class="muted">This component calls nothing that the report could see.</p>
        ) : (
          <ul class="plain">
            {outgoing.map((edge) => (
              <EdgeRow
                key={edge.id}
                edge={edge}
                otherId={edge.to}
                index={props.index}
                direction="out"
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeading title="Incoming relations" count={incoming.length} />
        {incoming.length === 0 ? (
          <p class="muted">Nothing the report could see calls this component.</p>
        ) : (
          <ul class="plain">
            {incoming.map((edge) => (
              <EdgeRow
                key={edge.id}
                edge={edge}
                otherId={edge.from}
                index={props.index}
                direction="in"
              />
            ))}
          </ul>
        )}
      </section>

      <Scenarios componentId={component.id} index={props.index} />
      <Metrics componentId={component.id} index={props.index} />
      <Permissions component={component} />
      <RelatedFindings componentId={component.id} index={props.index} />
    </div>
  );
}
