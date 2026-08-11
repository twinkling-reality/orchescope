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
