/**
 * Controls that do something.
 *
 * A control backed by the local server is only rendered when the bundle declares the matching
 * capability. When the capability is declared but unavailable the control is rendered disabled with the
 * server's own reason next to it, so the reader learns why rather than clicking a button that is inert.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { type CapabilityName, capabilityState } from '../presentation/capabilities.ts';
import { copyText, downloadText } from '../client.tsx';
import { useApp } from '../store.tsx';

export type ActionOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

export function CapabilityAction(props: {
  readonly capability: CapabilityName;
  readonly label: string;
  readonly hint?: string;
  readonly run: () => Promise<ActionOutcome>;
  readonly children?: ComponentChildren;
}) {
  const app = useApp();
  const state = capabilityState(app.capabilities, props.capability);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  if (!state.declared) {
    return null;
  }

  const onClick = () => {
    setBusy(true);
    void app
      .runTask(props.label, props.run)
      .then((result) => {
        setOutcome(result);
        app.announce(result.message);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setOutcome({ ok: false, message });
        app.announce(message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div class="action">
      <button
        type="button"
        class="button"
        disabled={!state.available || busy}
        title={state.available ? (props.hint ?? props.label) : state.reason}
        onClick={onClick}
      >
        {busy ? `${props.label}…` : props.label}
      </button>
      {state.available ? null : (
        <p class="action-reason">
          <span class="visually-hidden">Unavailable: </span>
          {state.reason}
        </p>
      )}
      {outcome === null ? null : <p class="action-result">{outcome.message}</p>}
      {props.children}
    </div>
  );
}

/** Works with no server, so it is never gated. */
export function CopyButton(props: {
  readonly text: string;
  readonly label: string;
  readonly announcement: string;
}) {
  const app = useApp();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const onClick = () => {
    void copyText(props.text).then((copied) => {
      setState(copied ? 'copied' : 'failed');
      app.announce(
        copied
          ? `${props.announcement} copied to the clipboard.`
          : 'The clipboard is not available in this browser context.',
      );
    });
  };
  return (
    <div class="action">
      <button
        type="button"
        class="button"
        onClick={onClick}
        title={`Copy ${props.announcement} as plain text`}
      >
        {props.label}
      </button>
      {state === 'idle' ? null : (
        <p class="action-result">
          {state === 'copied'
            ? 'Copied.'
            : 'The clipboard is not available here. Select the text and copy it manually.'}
        </p>
      )}
    </div>
  );
}

export function DownloadButton(props: {
  readonly filename: string;
  readonly mediaType: string;
  readonly text: string;
  readonly label: string;
}) {
  const app = useApp();
  const onClick = () => {
    downloadText(props.filename, props.mediaType, props.text);
    app.announce(`${props.filename} downloaded.`);
  };
  return (
    <div class="action">
      <button type="button" class="button" onClick={onClick} title={`Download ${props.filename}`}>
        {props.label}
      </button>
    </div>
  );
}
