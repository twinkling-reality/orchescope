/**
 * One answer, on one screen, and everything else is a link.
 *
 * Six passes of this screen answered `what do I do` in four places at once, and two of them printed the
 * same finding twice two hundred pixels apart: a hero naming the most serious one, a tile listing the
 * top three, a tile naming a goal to hand off, and a tile about how many files the scan managed to
 * read. A reader given four answers has been given none, and no amount of rewording fixes a fault that
 * is the *number* of answers rather than their wording. It also made the page scroll, and the tile at
 * the bottom carried the same band as the tile at the top, so scrolling read as the header repeating.
 *
 * So there is one block. The worst thing found, what it costs, the command that starts fixing it, and a
 * single quiet row of counts that link to the screens where the rest already lives.
 */

import type { Finding } from '@orchescope/schema';
import { describeBasis, describeSeverity } from '../../presentation/basis.ts';
import { formatInteger } from '../../presentation/format.ts';
import type { HeadlinePresentation } from '../../presentation/overview-presentation.ts';
import { useApp } from '../../store.tsx';
import { RefusalPanel } from '../../ui/primitives.tsx';
import { RunnableCommand } from '../../ui/runnable-command.tsx';

function Answer(props: { readonly worst: Finding }) {
  const app = useApp();
  const { worst } = props;
  const severity = describeSeverity(worst.severity);
  const basis = describeBasis(worst.basis);
  return (
    <div class="answer">
      <p class="answer-meta">
        <span class={`answer-sev is-${severity.value}`}>{severity.label}</span>
        <span>{basis.short}</span>
        <span>
          {`${formatInteger(worst.evidence.length)} ${worst.evidence.length === 1 ? 'piece' : 'pieces'} of evidence`}
        </span>
      </p>
      <h3 class="answer-title">{worst.title}</h3>
      <p class="answer-impact">{worst.impact}</p>
      <p class="answer-more">
        <button
          type="button"
          class="link-button"
          onClick={() => {
            app.navigate('findings', { finding: worst.id });
          }}
        >
          Show me why you think that
        </button>
      </p>
    </div>
  );
}

export function OverviewHeadline(props: {
  readonly presentation: HeadlinePresentation;
  readonly preamble: string;
}) {
  const { presentation } = props;
  const { worst, action } = presentation;

  return (
    <section class="tile is-band overview-headline">
      <h3 class="visually-hidden">What this report found</h3>
      <p class="hero-preamble">{props.preamble}</p>

      {worst === null ? (
        <RefusalPanel
          title={presentation.refusal?.title ?? 'We did not find anything to tell you about.'}
          commands={presentation.refusal?.commands ?? []}
        >
          <p>{presentation.refusal?.reason ?? ''}</p>
        </RefusalPanel>
      ) : (
        <Answer worst={worst} />
      )}

      {/* The one thing to do, in the same block as the thing it is about. It used to be a tile of its
          own, three hundred pixels away, naming something different. */}
      {action === null ? null : (
        <div class="answer-do">
          <p class="answer-do-title">{action.title}</p>
          <p class="answer-do-reason">{action.reason}</p>
          {action.commands[0] === undefined ? null : <RunnableCommand argv={action.commands[0]} />}
        </div>
      )}
    </section>
  );
}
