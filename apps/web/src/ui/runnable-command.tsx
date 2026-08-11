/**
 * A command you can take away, rather than a block of text to select by hand.
 *
 * Every command this report prints is something a reader has to get into a terminal, and until now the
 * only way to do that was to drag across a `pre` and hope the selection did not pick up the block's
 * padding. The command is still the whole visible string, because a control that hides what it copies
 * is a control that cannot be checked against the documentation.
 *
 * It does not run anything. Nothing in this report runs a command on the reader's behalf: the product
 * produces a bounded goal and a person or a coding agent makes the change, which is the rule the whole
 * loop rests on. So the control is copy, and the label says so.
 */

import { useState } from 'preact/hooks';
import { copyText } from '../client.tsx';
import { formatArgv } from '../presentation/format.ts';
import { useApp } from '../store.tsx';

export function RunnableCommand(props: {
  readonly argv: readonly string[];
  readonly label?: string;
}) {
  const app = useApp();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const text = formatArgv(props.argv);
  const onClick = () => {
    void copyText(text).then((copied) => {
      setState(copied ? 'copied' : 'failed');
      app.announce(
        copied
          ? `${text} copied to the clipboard.`
          : 'The clipboard is not available in this browser context.',
      );
    });
  };
  return (
    <div class="runnable">
      {props.label === undefined ? null : <p class="command-label">{props.label}</p>}
      <div class="runnable-row">
        <pre class="command">{text}</pre>
        <button type="button" class="runnable-copy" onClick={onClick} title={`Copy ${text}`}>
          {state === 'copied' ? 'Copied' : 'Copy'}
          <span class="visually-hidden">{` the command ${text}`}</span>
        </button>
      </div>
      {state === 'failed' ? (
        <p class="action-result">
          The clipboard is not available here. Select the command and copy it manually.
        </p>
      ) : null}
    </div>
  );
}
