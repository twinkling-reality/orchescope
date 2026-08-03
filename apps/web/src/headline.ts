/**
 * The sentence the delta screen leads with, generated from the delta rather than written into it.
 *
 * It is a sentence and not a statistic because the number above it is already the statistic. What a
 * reader needs first is what the number means, and the sentence has to be true of every shape the
 * delta can take, including the two that are easy to word badly: nothing was declared, and everything
 * declared ran.
 *
 * A count below thirteen is spelled, so the display line stays one typographic voice. Above that it is
 * a numeral and the caller sets it in the mono face, because "two hundred and eight" is not a thing a
 * reader can compare against the next report.
 */

export type HeadlineSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'count'; readonly value: number };

const SPELLED: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/** The spelled form of a small count, lower case, or null when the numeral is the honest rendering. */
export function spellCount(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value >= SPELLED.length) {
    return null;
  }
  return SPELLED[value] ?? null;
}

const text = (value: string): HeadlineSegment => ({ kind: 'text', text: value });

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * A count and the clause that follows it. A spelled count opening a sentence is capitalised and one
 * inside a sentence is not, which is the whole reason this is a function rather than a template.
 */
function counted(
  value: number,
  clause: { readonly one: string; readonly many: string },
  position: 'opens' | 'inside',
): HeadlineSegment[] {
  const suffix = value === 1 ? clause.one : clause.many;
  const spelled = spellCount(value);
  if (spelled === null) {
    return [{ kind: 'count', value }, text(suffix)];
  }
  return [text((position === 'opens' ? capitalise(spelled) : spelled) + suffix)];
}

export function deltaHeadline(input: {
  readonly declared: number;
  readonly neverExercised: number;
  readonly exercisedNotDeclared: number;
}): readonly HeadlineSegment[] {
  const { declared, neverExercised, exercisedNotDeclared } = input;

  if (declared === 0) {
    if (exercisedNotDeclared === 0) {
      return [text('This repository declares nothing for a run to exercise.')];
    }
    return counted(
      exercisedNotDeclared,
      {
        one: ' thing ran, and this repository declares none of it.',
        many: ' things ran, and this repository declares none of them.',
      },
      'opens',
    );
  }

  if (neverExercised === 0) {
    if (exercisedNotDeclared === 0) {
      return [
        text('Everything this repository declares ran, and nothing ran that it does not declare.'),
      ];
    }
    return [
      text('Everything this repository declares ran, and so did '),
      ...counted(
        exercisedNotDeclared,
        { one: ' thing it does not declare.', many: ' things it does not declare.' },
        'inside',
      ),
    ];
  }

  return counted(
    neverExercised,
    {
      one: ' of the things this repository declares has never run.',
      many: ' of the things this repository declares have never run.',
    },
    'opens',
  );
}
