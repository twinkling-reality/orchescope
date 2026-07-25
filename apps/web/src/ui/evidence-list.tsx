/**
 * Evidence records, rendered by kind. This is the part of a finding a reader argues with, so the record
 * is shown as it was stored rather than paraphrased.
 */

import { ENDPOINTS, type OpenLocationRequest, parseOpenLocation } from '../api.ts';
import { type CapabilityName, capabilityState } from '../capabilities.ts';
import { postJson } from '../client.tsx';
import { evidenceLocation, viewEvidence } from '../evidence-text.ts';
import { formatInteger } from '../format.ts';
import type { GraphIndex } from '../graph-index.ts';
import { useApp } from '../store.tsx';
import { CapabilityAction } from './actions.tsx';
import { BasisBadge, Callout, Chip } from './atoms.tsx';

const OPEN_LOCATION: CapabilityName = 'open_source_location';

export function OpenLocationAction(props: {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}) {
  const app = useApp();
  const state = capabilityState(app.capabilities, OPEN_LOCATION);
  if (!state.declared) {
    return null;
  }
  const body: OpenLocationRequest = {
    file: props.file,
    line: props.line,
    ...(props.column === undefined ? {} : { column: props.column }),
  };
  return (
    <CapabilityAction
      capability={OPEN_LOCATION}
      label="Open source location"
      hint={`Ask the local server to open ${props.file} at line ${props.line}`}
      run={async () => {
        const result = await postJson(ENDPOINTS.openLocation, body, parseOpenLocation);
        if (!result.ok) {
          return { ok: false, message: result.message };
        }
        return result.value.opened
          ? { ok: true, message: `Asked the editor to open ${props.file}:${props.line}.` }
          : { ok: false, message: `The server did not open ${props.file}:${props.line}.` };
      }}
    />
  );
}

export function EvidenceRecord(props: { readonly evidenceId: string; readonly index: GraphIndex }) {
  const record = props.index.evidenceById.get(props.evidenceId);
  if (record === undefined) {
    return (
      <li class="evidence missing">
        <p>
          {`Evidence ${props.evidenceId} is referenced but is not included in this report bundle.`}
        </p>
      </li>
    );
  }
  const view = viewEvidence(record);
  const location = evidenceLocation(record);
  return (
    <li class="evidence">
      <div class="evidence-head">
        <Chip label={view.kindLabel} title={`Evidence kind: ${view.kind}`} />
        <BasisBadge basis={view.basis} />
        <span class="mono muted">{view.id}</span>
        <span class="muted">{`produced by ${view.producer}`}</span>
      </div>
      <p class="evidence-headline">{view.headline}</p>
      <dl class="definitions tight">
        {view.fields.map((field) => (
          <div class="definition" key={field.label}>
            <dt>{field.label}</dt>
            <dd class={field.code === true ? 'mono' : undefined}>{field.value}</dd>
          </div>
        ))}
      </dl>
      {location === null ? null : <OpenLocationAction file={location.file} line={location.line} />}
    </li>
  );
}

export function EvidenceList(props: {
  readonly evidenceIds: readonly string[];
  readonly index: GraphIndex;
}) {
  if (props.evidenceIds.length === 0) {
    return <Callout tone="warn" title="This claim carries no evidence references." />;
  }
  const missing = props.evidenceIds.filter((id) => !props.index.evidenceById.has(id));
  return (
    <div class="evidence-list">
      {missing.length === 0 ? null : (
        <Callout
          tone="warn"
          title={`${formatInteger(missing.length)} evidence records are referenced but absent from this bundle.`}
        />
      )}
      <ul class="plain">
        {props.evidenceIds.map((id) => (
          <EvidenceRecord key={id} evidenceId={id} index={props.index} />
        ))}
      </ul>
    </div>
  );
}
