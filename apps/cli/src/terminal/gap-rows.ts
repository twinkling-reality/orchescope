/**
 * What could not be looked at.
 *
 * `Not inspected` and `Input problems` were two blocks answering one question with two vocabularies and
 * two ceilings, one of which was no ceiling at all. They are one region with one key here, and the key
 * is what a reader greps for across a whole corpus.
 *
 * This region answers a shape question, which kinds of thing were not read, rather than an inventory
 * question. The inventory is in the machine readable document, which is why a row states a
 * classification and never the paragraph behind it.
 */

import type { AuditResult } from '@orchescope/usecases';
import { cut, visibleWidth } from './display-width.ts';
import { type Layout, REST_COLUMN, type Region, type Row } from './document-grid.ts';

type Coverage = AuditResult['graph']['coverage'];

/**
 * Four rows, then one line saying how many kinds were left out.
 *
 * Skipped files are grouped by reason before they reach a row, so the seven reasons the schema allows
 * contribute at most seven rows and the corpus never produces more than two. Unsupported areas are per
 * area and the schema bounds neither their count nor their length, which is the only way this list can
 * grow. Four rows shows a reader that more than one kind of gap exists; the count carries the rest.
 */
const ROW_CEILING = 4;

/**
 * How many reasons a bounded sample names before it stops naming them.
 *
 * The reason vocabulary is a closed set of seven, so this is a ceiling on a line's width rather than on
 * a list that could grow. Three is where the sentence stops fitting beside the count at eighty columns.
 */
const NAMED_REASONS = 3;

const adapterName = (adapterId: string): string => adapterId.replace(/^adapter:/, '');

/**
 * Symbol and word per kind, and no kind renders as a colour.
 *
 * An area with no `kind` reads as `unread` rather than as a guess: the field is optional in the schema,
 * so a report written by an older build carries areas whose cause nobody recorded, and inventing one
 * would be this renderer analysing.
 */
const UNSUPPORTED_STATE: Readonly<Record<string, string>> = {
  language_not_analysed: '. unparsed',
  adapter_found_nothing: '. unread',
  // The name this build no longer writes, still rendered so a report stored by an earlier one reads.
  adapter_blind_spot: '. unread',
  discarded_relation: '. discarded',
  excluded_from_analysis: '. excluded',
};

/**
 * The count is the total; the names come from the sample, and never with counts of their own.
 *
 * The word is `path` rather than `file`: a directory traversal declined to enter is one entry standing
 * for everything inside it, and calling two excluded directories two files understates what was lost in
 * the one line a reader has to notice it in.
 *
 * `filesSkipped` is how many paths were skipped. `skipped` is a bounded sample of them, and on
 * `pydantic-ai-exercised` the two are eighty one and thirty four. Counting reasons out of the sample
 * and printing them as though they described the whole is an inference presented as an observation, so
 * a per reason count is printed only when the sample is the whole, which is what makes the two forms
 * distinguishable rather than merely different.
 */
const skippedRows = (coverage: Coverage): readonly Row[] => {
  const sample = coverage.skipped;
  if (sample.length === 0) return [];
  const total = coverage.filesSkipped ?? sample.length;
  const byReason = new Map<string, number>();
  for (const entry of sample) byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const readable = (reason: string): string => reason.replaceAll('_', ' ');
  if (total === sample.length) {
    return reasons.map(
      ([reason, count]) =>
        ({
          kind: 'keyed',
          key: 'gap',
          state: '. skipped',
          text: `${count} ${count === 1 ? 'path' : 'paths'}, ${readable(reason)}`,
        }) as const,
    );
  }
  const named = reasons.slice(0, NAMED_REASONS).map(([reason]) => readable(reason));
  const rest = reasons.length - named.length;
  return [
    {
      kind: 'keyed',
      key: 'gap',
      state: '. skipped',
      text: `${total} paths, ${sample.length} sampled: ${named.join(', ')}${rest === 0 ? '' : ` and ${rest} more`}`,
    },
  ];
};

/**
 * The area and its classification, and never the paragraph behind either.
 *
 * `reason` is prose the schema caps at no length at all, and on `crewai` it is two hundred and twenty
 * six characters, which rendered as four wrapped rows inside a sixty nine column frame. A terminal row
 * states a classification; a paragraph is the report's job. The kind is a closed set, so the
 * classification is bounded by construction and cannot be widened by an adapter author, and `reason`
 * and `remediation` are both in the machine readable document.
 */
const unsupportedRows = (coverage: Coverage): readonly Row[] =>
  coverage.unsupported.map(
    (area) =>
      ({
        kind: 'keyed',
        key: 'gap',
        state: UNSUPPORTED_STATE[area.kind ?? ''] ?? '. unread',
        text: area.area,
      }) as const,
  );

/**
 * A failed adapter is the one gap whose detail a reader can act on, so it wraps rather than being cut.
 *
 * The manifest validator's message ends in the pointer to the field it rejected, and that pointer is the
 * only thing in the whole report that tells a reader which line of their manifest to change. It is not a
 * command and not a caveat, so it is neither of the two things this document exempts from truncation;
 * instead it is allowed one further row, which holds every message the validator produces at eighty
 * columns, and that row is cut like any other if a future adapter writes something longer. Two is where
 * a row stops being a row and becomes a paragraph in a column.
 */
const FAILED_ROWS = 2;

/** Break at the last space that fits, so a pointer into a manifest is not split across two rows. */
const breakAt = (text: string, budget: number): number => {
  const space = text.lastIndexOf(' ', budget);
  return space > budget / 2 ? space : budget;
};

const failedRows = (coverage: Coverage, layout: Layout): readonly Row[] =>
  coverage.adapters
    .filter((adapter) => adapter.status === 'failed')
    .flatMap((adapter) => {
      const message = `${adapterName(adapter.adapterId)}: ${adapter.detail ?? 'the adapter failed'}`;
      const budget = layout.effective - (REST_COLUMN - 1);
      if (visibleWidth(message) <= budget) {
        return [{ kind: 'keyed', key: 'gap', state: 'x failed', text: message }] as const;
      }
      const split = breakAt(message, budget);
      return [
        { kind: 'keyed', key: 'gap', state: 'x failed', text: message.slice(0, split) },
        { kind: 'detail', text: cut(message.slice(split).trimStart(), budget * (FAILED_ROWS - 1)) },
      ] as const;
    });

/**
 * Documents traversal discovered and no parser read.
 *
 * `filesDiscovered` counts everything traversal recognised as some language and `filesParsed` counts the
 * source that reached a parser, so configuration sits in the difference between them and appeared in
 * neither half of the line a reader checks coverage on. On one field report's target that difference is
 * a hundred and eighty five documents, discovered, counted and named nowhere.
 *
 * It says what they are and not that they were read, because whether one is opened depends on whether a
 * configuration or manifest reader knows that file: on the same target the configuration reader opened
 * none of them and the manifest reader opened one. Claiming the population was read would replace a
 * silence with an overstatement.
 */
const configurationRow = (coverage: Coverage): readonly Row[] => {
  const supported = coverage.filesInSupportedLanguages ?? coverage.filesParsed;
  const documents = coverage.filesDiscovered - supported;
  if (documents <= 0) return [];
  return [
    {
      kind: 'keyed',
      key: 'gap',
      state: '. unparsed',
      text: `${documents} configuration ${documents === 1 ? 'document' : 'documents'}, not parsed as source`,
    } as const,
  ];
};

const truncatedRow = (coverage: Coverage): readonly Row[] =>
  coverage.truncated
    ? [
        {
          kind: 'keyed',
          key: 'gap',
          state: '. partial',
          text: 'the scan hit its file limit, so what is below is not all of it',
        } as const,
      ]
    : [];

export const gapRegion = (coverage: Coverage, layout: Layout): Region => {
  /*
   * Worst first: an input the project wrote on purpose and this build rejected outranks a limit this
   * build has, and a scan that stopped early outranks a file it chose not to read.
   */
  const entries = [
    ...failedRows(coverage, layout),
    ...truncatedRow(coverage),
    ...skippedRows(coverage),
    ...unsupportedRows(coverage),
    ...configurationRow(coverage),
  ];
  const keyed = entries.filter((row) => row.kind === 'keyed');
  if (keyed.length <= ROW_CEILING) return entries;
  const kept: Row[] = [];
  let shown = 0;
  for (const row of entries) {
    if (row.kind === 'keyed') {
      shown += 1;
      if (shown > ROW_CEILING) break;
    }
    kept.push(row);
  }
  kept.push({
    kind: 'keyed',
    key: 'gap',
    text: `${keyed.length - ROW_CEILING} more kinds of gap, in the report`,
  });
  return kept;
};
