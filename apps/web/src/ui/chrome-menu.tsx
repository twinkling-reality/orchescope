import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Eyebrow } from './primitives.tsx';

export interface ChromeMenuProps {
  readonly title: string;
  readonly open: boolean;
  readonly wide?: boolean;
  readonly icon: ComponentChildren;
  readonly children: ComponentChildren;
  readonly onOpenChange: (open: boolean) => void;
}

/** One anchored interaction for both pieces of chrome-level information. */
export function ChromeMenu(props: ChromeMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (props.open) panelRef.current?.focus();
  }, [props.open]);

  return (
    <div class="chrome-menu">
      <button
        type="button"
        class="icon-button"
        title={props.title}
        aria-expanded={props.open}
        onClick={() => {
          props.onOpenChange(!props.open);
        }}
      >
        {props.icon}
        <span class="visually-hidden">{props.title}</span>
      </button>
      {props.open ? (
        <div
          class={
            props.wide === true ? 'chrome-menu-body is-wide fade-in' : 'chrome-menu-body fade-in'
          }
          role="dialog"
          aria-label={props.title}
          tabIndex={-1}
          ref={panelRef}
        >
          <div class="chrome-menu-head">
            <Eyebrow level={3}>{props.title}</Eyebrow>
            <button
              type="button"
              class="button"
              onClick={() => {
                props.onOpenChange(false);
              }}
            >
              Close
            </button>
          </div>
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
