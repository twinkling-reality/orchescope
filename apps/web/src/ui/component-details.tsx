/**
 * The details panel for one component: what it is, where it was found, what it is connected to, what it
 * cost, what it is allowed to do and what the report says about it.
 *
 * The first thing it states is whether the component ran, drawn with the same filled and hollow marks
 * the delta bar and the components table use, because that is the question the rest of the panel is
 * evidence for.
 */

import type { Component, Edge, EdgePolicy } from '@orchescope/schema';
import {
  formatConfidence,
  formatDuration,
  formatInteger,
  formatSourceLocation,
  formatUsd,
  humanise,
} from '../presentation/format.ts';
import type { GraphIndex } from '../presentation/graph-index.ts';
import { useApp } from '../store.tsx';
import { OpenLocationAction } from './evidence-list.tsx';
import { presenceOf } from '../presentation/component-presence.ts';
import { PresenceMark } from './presence.tsx';
import {
  BasisChip,
  Data,
  DefinitionList,
  type DefinitionRow,
  Eyebrow,
  Meta,
  OptionalNumber,
  RefusalPanel,
  SeverityMark,
} from './primitives.tsx';
import { SafeLink } from './safe-link.tsx';

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
      <p class="edge-head">
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
      </p>
      <Meta>
        <span>{humanise(props.edge.kind)}</span>
        <BasisChip basis={props.edge.basis} />
        {props.edge.runtimeOnly ? <span>observed only, absent from the static model</span> : null}
      </Meta>
      <p class="note">{describePolicy(props.edge.policy)}</p>
      {observation === undefined ? (
        <p class="note">Never observed in a run.</p>
      ) : (
        <p class="note">
          <Data>{formatInteger(observation.executionCount)}</Data>
          {' executions, '}
          <Data>{formatInteger(observation.errorCount)}</Data>
          {' errors, '}
          <Data>{formatInteger(observation.retryCount)}</Data>
          {' retries, '}
          <Data>{formatDuration(observation.totalDurationMs)}</Data>
          {' total'}
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
    <section class="group">
      <Eyebrow
        level={4}
      >{`How this ${humanise(props.component.kind).toLowerCase()} is set up`}</Eyebrow>
      <DefinitionList rows={rows} />
    </section>
  );
}

function Locations(props: { readonly component: Component }) {
  const { sourceLocations, configLocations } = props.component;
  return (
    <section class="group">
      <Eyebrow level={4}>Where it was found</Eyebrow>
      {sourceLocations.length === 0 && configLocations.length === 0 ? (
        <p class="note">Nothing recorded where in the code this came from.</p>
      ) : null}
      <ul class="plain small">
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
    <section class="group">
      <Eyebrow level={4} count={props.component.permissions.length}>
        Permissions
      </Eyebrow>
      {props.component.permissions.length === 0 ? (
        <p class="note">
          No permission was discovered for this component. That is not proof it has none.
        </p>
      ) : (
        <ul class="plain small">
          {props.component.permissions.map((permission) => (
            <li key={`${permission.kind}:${permission.scope}:${permission.mode}`}>
              <span>{humanise(permission.kind)}</span>
              <span class="mono">{` ${permission.scope} `}</span>
              <span class="muted">{permission.mode}</span>
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
      <section class="group">
        <Eyebrow level={4}>Measured cost</Eyebrow>
        <p class="note">
          {props.index.hasRuntimeEvidence
            ? 'No run measured anything about this. That is nothing measured, not something measured as zero.'
            : 'Nothing has been run, so nothing about this was measured.'}
        </p>
      </section>
    );
  }
  return (
    <section class="group">
      <Eyebrow level={4}>Measured cost</Eyebrow>
      <p class="note">Observed in the runs folded into this report.</p>
      <DefinitionList
        rows={[
          { label: 'Executions', value: <Data>{formatInteger(metrics.executionCount)}</Data> },
          { label: 'Self time', value: <Data>{formatDuration(metrics.selfDurationMs)}</Data> },
          { label: 'Total time', value: <Data>{formatDuration(metrics.totalDurationMs)}</Data> },
          {
            label: 'p95 duration',
            value: <OptionalNumber value={metrics.p95DurationMs ?? null} render={formatDuration} />,
          },
          { label: 'Input tokens', value: <Data>{formatInteger(metrics.inputTokens)}</Data> },
          { label: 'Output tokens', value: <Data>{formatInteger(metrics.outputTokens)}</Data> },
          {
            label: 'Cost',
            value: <OptionalNumber value={metrics.costUsd ?? null} render={formatUsd} />,
          },
          { label: 'Errors', value: <Data>{formatInteger(metrics.errorCount)}</Data> },
          { label: 'Retries', value: <Data>{formatInteger(metrics.retryCount)}</Data> },
        ]}
      />
    </section>
  );
}

function RelatedFindings(props: { readonly componentId: string; readonly index: GraphIndex }) {
  const app = useApp();
  const findings = props.index.findingsByComponent.get(props.componentId) ?? [];
  return (
    <section class="group">
      <Eyebrow level={4} count={findings.length}>
        Findings naming this component
      </Eyebrow>
      {findings.length === 0 ? (
        <p class="note">Nothing this report found is about this.</p>
      ) : (
        <ul class="plain small">
          {findings.map((finding) => (
            <li class="finding-link" key={finding.id}>
              <SeverityMark severity={finding.severity} />
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  app.navigate('findings', { finding: finding.id });
                }}
              >
                {finding.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Scenarios(props: { readonly componentId: string; readonly index: GraphIndex }) {
  const ids = props.index.scenarioIdsByComponent.get(props.componentId) ?? [];
  return (
    <section class="group">
      <Eyebrow level={4} count={ids.length}>
        Scenarios it appeared in
      </Eyebrow>
      <p class="note">Worked out from the runs whose evidence names this.</p>
      {ids.length === 0 ? (
        <p class="note">No run has produced any evidence naming this.</p>
      ) : (
        <ul class="plain small">
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
      <RefusalPanel title="That is not in this report.">
        <p class="mono">{props.componentId}</p>
      </RefusalPanel>
    );
  }
  const outgoing = props.index.outgoing.get(component.id) ?? [];
  const incoming = props.index.incoming.get(component.id) ?? [];

  return (
    <div class="details fade-in">
      <h4>{component.displayName}</h4>
      <p class="note">
        <PresenceMark presence={presenceOf(props.index, component)} />
      </p>
      <Meta>
        <span>{humanise(component.kind)}</span>
        <BasisChip basis={component.basis} />
        <span>{`confidence ${formatConfidence(component.confidence)}`}</span>
        <span>{component.id}</span>
      </Meta>

      {component.description === undefined ? null : <p class="small">{component.description}</p>}

      <DefinitionList
        rows={[
          {
            label: 'Identity',
            value: `${component.identity.namespace} / ${component.identity.localName}`,
            code: true,
          },
          {
            label: 'Declared in',
            value:
              [
                component.presence.static ? 'source or configuration' : null,
                component.presence.manifest ? 'a manifest' : null,
                component.presence.runtime ? 'a runtime trace' : null,
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

      <section class="group">
        <Eyebrow level={4} count={outgoing.length}>
          Outgoing relations
        </Eyebrow>
        {outgoing.length === 0 ? (
          <p class="note">This calls nothing the report could see.</p>
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

      <section class="group">
        <Eyebrow level={4} count={incoming.length}>
          Incoming relations
        </Eyebrow>
        {incoming.length === 0 ? (
          <p class="note">Nothing the report could see calls this.</p>
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
