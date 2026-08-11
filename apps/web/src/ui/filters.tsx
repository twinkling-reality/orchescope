/**
 * Filter controls. Every change is announced politely, because a list that silently shrinks is a list a
 * screen reader user has no way to notice.
 */

import { useId } from 'preact/hooks';
import { pluralise } from '../presentation/format.ts';
import { useApp } from '../store.tsx';

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
}

export function TokenFilter(props: {
  readonly legend: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const app = useApp();
  if (props.options.length === 0) {
    return null;
  }
  const toggle = (value: string) => {
    const next = props.selected.includes(value)
      ? props.selected.filter((entry) => entry !== value)
      : [...props.selected, value];
    props.onChange(next);
    app.announce(
      next.length === 0
        ? `${props.legend} filter cleared, showing all.`
        : `${props.legend} filter set to ${next.join(', ')}.`,
    );
  };
  return (
    <fieldset class="filter-group">
      <legend>{props.legend}</legend>
      <div class="filter-options">
        {props.options.map((option) => {
          const checked = props.selected.includes(option.value);
          return (
            <label class={checked ? 'filter-option checked' : 'filter-option'} key={option.value}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  toggle(option.value);
                }}
              />
              <span>{option.label}</span>
              {option.count === undefined ? null : <span class="filter-count">{option.count}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The plural is given rather than derived. Suffixing `es` produced "11 findinges shown" and "33
 * componentes shown" in a shipped report, which is what happens when English is treated as a rule.
 */
export function SearchField(props: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
  readonly resultCount?: number;
  readonly resultNoun: string;
  readonly resultPlural: string;
}) {
  const id = useId();
  const statusId = `${id}-status`;
  return (
    <div class="search-field">
      <label class="field-label" for={id}>
        {props.label}
      </label>
      <input
        id={id}
        type="search"
        class="input"
        value={props.value}
        placeholder={props.placeholder ?? ''}
        aria-describedby={statusId}
        onInput={(event) => {
          props.onChange((event.currentTarget as HTMLInputElement).value);
        }}
      />
      <p class="search-status" id={statusId} aria-live="polite">
        {props.resultCount === undefined
          ? ''
          : `${pluralise(props.resultCount, props.resultNoun, props.resultPlural)} shown`}
      </p>
    </div>
  );
}
