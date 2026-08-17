/**
 * Counting a thing, and naming it correctly for how many there are.
 *
 * This lives in the domain rather than beside a renderer because counting is what half of this product
 * reports and every layer above the domain may reach it. The version before this one lived in the CLI's
 * terminal styling module, which `packages/usecases` cannot import, so the phase summaries the usecase
 * layer writes carried `10 run(s) reconciled, 130 component metric(s) attributed, 1 undeclared
 * component(s), 0 contradiction(s)`. A parenthesised `s` is what a program prints when it has decided
 * the reader will do the grammar.
 *
 * An irregular plural is passed rather than derived. Guessing at English morphology from a suffix is a
 * rule that is right most of the time, and the times it is wrong are the ones a reader notices.
 */
export const formatCount = (value: number, singular: string, plural = `${singular}s`): string =>
  `${value} ${value === 1 ? singular : plural}`;

/**
 * The verb that agrees with a count, for a sentence built around one.
 *
 * `formatCount` gets the noun right and the sentence continues past it: `3 consequential operations was
 * left unreported` and `2 runs was recorded` both reached a reader, in the report a rule writes to explain
 * what it decided not to say. A tool that reasons about grammar less carefully than it reasons about
 * evidence invites the reader to weigh the rest of its output the same way.
 *
 * Both forms are passed for the reason `formatCount` gives for the plural: English verbs are irregular
 * where it matters, and `was`/`were` is not a suffix rule. It takes the same count the noun took, so the
 * two cannot disagree by being computed from different things.
 */
export const agree = (value: number, singular: string, plural: string): string =>
  value === 1 ? singular : plural;
