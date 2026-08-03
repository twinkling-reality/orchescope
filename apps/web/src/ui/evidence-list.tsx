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
import { BasisChip, DefinitionList, Meta, RefusalPanel } from './primitives.tsx';

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
        <p class="small">
          {`Evidence ${props.evidenceId} is referenced but is not included in this report bundle.`}
        </p>
      </li>
    );
  }
  const view = viewEvidence(record);
  const location = evidenceLocation(record);
  return (
    <li class="evidence">
      <Meta>
        <span>{view.kindLabel}</span>
        <BasisChip basis={view.basis} />
        <span>{view.id}</span>
        <span>{`produced by ${view.producer}`}</span>
      </Meta>
      <p class="evidence-headline">{view.headline}</p>
      <DefinitionList
        rows={view.fields.map((field) => ({
          label: field.label,
          value: field.value,
          ...(field.code === true ? { code: true } : {}),
        }))}
      />
      {location === null ? null : <OpenLocationAction file={location.file} line={location.line} />}
    </li>
  );
}

export function EvidenceList(props: {
  readonly evidenceIds: readonly string[];
  readonly index: GraphIndex;
}) {
  if (props.evidenceIds.length === 0) {
    return (
      <RefusalPanel title="This claim carries no evidence references.">
        <p>
          A finding without evidence is an assertion. This one reached the report anyway so that the
          gap is visible rather than silently absent.
        </p>
      </RefusalPanel>
    );
  }
  const missing = props.evidenceIds.filter((id) => !props.index.evidenceById.has(id));
  return (
    <>
      {missing.length === 0 ? null : (
        <RefusalPanel
          title={`${formatInteger(missing.length)} evidence records are referenced and absent from this bundle.`}
        >
          <p>They are listed below by identifier, so nothing is quietly dropped.</p>
        </RefusalPanel>
      )}
      <ul class="evidence-list">
        {props.evidenceIds.map((id) => (
          <EvidenceRecord key={id} evidenceId={id} index={props.index} />
        ))}
      </ul>
    </>
  );
}
