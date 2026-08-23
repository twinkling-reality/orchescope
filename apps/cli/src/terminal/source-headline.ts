/**
 * What this build read here, and what it read to say so.
 *
 * Line one is the project name and what the scan found in it. A bare part count is a size rather than a
 * description: "33 parts found" tells a reader nothing that "5 agents, 7 tools and 2 models" does not
 * tell them better, and it leaves the name in column one looking like a mode rather than like the thing
 * being described, which is what "demo" read as. Line two is coverage and how much runtime evidence
 * exists, because a count with no denominator is a claim about a whole nobody measured, and because
 * whether anything has ever run is the fact that decides what the rest of this document is able to say.
 *
 * It says what the scan found rather than what the project has, and the difference is the whole product.
 * One field report's target wires MCP tool calls, human approval and a tool registry, and this build
 * claims none of the framework its agent runtime is written in: the graph held the periphery, and the
 * line said the project had one agent and twenty tools. Every number here is true of the scan and the
 * sentence has to be true of the same thing, which is the identical correction the coverage block's
 * adapter languages needed.
 */

import { formatCount } from '@orchescope/domain';
import type { AuditResult } from '@orchescope/usecases';
import { cut, visibleWidth } from './display-width.ts';
import { KEY_WIDTH, type Layout, type Region, type Row, VALUE_COLUMN } from './document-grid.ts';

type Coverage = AuditResult['graph']['coverage'];

const adapterName = (adapterId: string): string => adapterId.replace(/^adapter:/, '');

/**
 * The component identities a reader of an agent system asks about first.
 *
 * A workflow step is not necessarily an agent. Keeping workflows and their registered steps in this
 * inventory makes that distinction visible on the terminal surface instead of replacing a false agent
 * count with silence. Prompts, queues, entry points and memories remain in the full graph. A project with
 * none of these headline identities falls back to the part count, because naming zero of everything is
 * worse than naming a size.
 */
const HEADLINE_KINDS = [
  { kind: 'agent', singular: 'agent' },
  { kind: 'workflow', singular: 'workflow' },
  { kind: 'workflow_step', singular: 'workflow step' },
  { kind: 'tool', singular: 'tool' },
  { kind: 'model', singular: 'model' },
] as const;

/** `a`, `a and b`, `a, b and c`. No serial comma, so the last two read as a pair. */
const joinWords = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

const inventory = (result: AuditResult): string => {
  const counts = new Map<string, number>();
  for (const component of result.graph.components) {
    counts.set(component.kind, (counts.get(component.kind) ?? 0) + 1);
  }
  const named = HEADLINE_KINDS.flatMap(({ kind, singular }) => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [formatCount(count, singular)];
  });
  return named.length === 0
    ? formatCount(result.bundle.summary.componentCount, 'part')
    : joinWords(named);
};

/**
 * Variants longest first, so a narrow terminal loses the framing words and never the counts.
 */
const headlineVariants = (result: AuditResult): readonly string[] => {
  const found = inventory(result);
  return [`this scan found ${found}`, found];
};

/**
 * How much runtime evidence exists, which is not the same as how many runs happened.
 *
 * The count used to be of runs on record, and a run that exported no telemetry is on record. A reader
 * who traced an uninstrumented target saw "1 run on record" on a document whose every runtime claim was
 * still missing, and had no way to tell that the run was the reason rather than the remedy.
 */
const runsPhrase = (result: AuditResult): string => {
  const observed = result.bundle.summary.observedRunCount;
  const silent = result.bundle.summary.silentRunCount;
  if (observed === undefined && silent === undefined) {
    const recorded = result.bundle.summary.runCount ?? 0;
    return recorded === 0 ? 'no runs on record' : `${formatCount(recorded, 'run')} on record`;
  }
  const observedCount = observed ?? 0;
  const silentCount = silent ?? 0;
  if (observedCount > 0 && silentCount > 0) {
    return `${formatCount(observedCount, 'observed run')}, ${formatCount(silentCount, 'silent run')} (no spans)`;
  }
  if (observedCount > 0) return formatCount(observedCount, 'observed run');
  return silentCount === 0
    ? 'no runs on record'
    : `${formatCount(silentCount, 'silent run')} (no spans)`;
};

/**
 * What was read, over a denominator that says what it counts.
 *
 * "read from 3858 of 3858 files" is completeness over the files this build parses, printed as though it
 * were completeness over the repository. The target it was measured on tracks 4224 files, so a reader
 * was shown a rate of one hundred percent against a denominator that left 366 of their files out, and
 * nothing on the line said which whole was being divided.
 *
 * The denominator is named instead, and the documents beside it are counted where there are any.
 * Configuration is discovered and read for what it declares rather than parsed, so it belongs in neither
 * half of the parse rate and disappeared from the document entirely. What this still cannot say is how
 * many tracked files are in formats it never records, because the number reaches the coverage block only
 * as the language markers it recognises.
 */
const coverageVariants = (result: AuditResult, verbose: boolean): readonly string[] => {
  const coverage = result.graph.coverage;
  const supported = coverage.filesInSupportedLanguages ?? coverage.filesParsed;
  const files = `${coverage.filesParsed} of ${formatCount(supported, 'source file')}`;
  const documents = coverage.filesDiscovered - supported;
  const beside =
    documents <= 0 ? '' : ` beside ${formatCount(documents, 'configuration document')}`;
  const runs = runsPhrase(result);
  const graph = `${formatCount(result.bundle.summary.componentCount, 'part')} and ${formatCount(result.bundle.summary.edgeCount, 'link')}`;
  if (!verbose)
    return [
      `read from ${files}${beside}, with ${runs}`,
      `read from ${files}, with ${runs}`,
      `${files}; ${runs}`,
      `read from ${files}`,
    ];
  /*
   * The verb is shed before any fact is. Naming the denominator cost seven columns and pushed this line
   * past eighty, and what fell off the end was whether anything had ever run, which is the fact that
   * decides what the rest of the document can say.
   */
  return [
    `${graph}; ${files}${beside} read; ${runs}`,
    `${graph}; ${files} read; ${runs}`,
    `${graph}; ${files}; ${runs}`,
    `${graph}; ${files} read`,
    `read from ${files}, with ${runs}`,
    `read from ${files}`,
  ];
};

/** The widest variant that still fits the column it starts in, else the narrowest one written. */
const fitting = (variants: readonly string[], start: number, layout: Layout): string => {
  const shortest = variants[variants.length - 1] ?? '';
  return variants.find((variant) => start + visibleWidth(variant) <= layout.effective) ?? shortest;
};

const sourceRows = (
  result: AuditResult,
  layout: Layout,
  bold: (text: string) => string,
  verbose: boolean,
): readonly Row[] => {
  const variants = headlineVariants(result);
  const shortest = variants[variants.length - 1] ?? '';
  const key = cut(result.bundle.projectName, layout.effective - visibleWidth(shortest) - 2);
  const start = Math.max(KEY_WIDTH, visibleWidth(key)) + 2;
  return [
    { kind: 'keyed', key, text: fitting(variants, start, layout), paintKey: bold },
    {
      kind: 'detail',
      align: 'value',
      text: fitting(coverageVariants(result, verbose), VALUE_COLUMN - 1, layout),
    },
  ];
};

/**
 * What this build found, said as what it read rather than as what is there.
 *
 * "Nothing looked like an agent, tool, or model" is a claim about the repository and this reader can
 * only make one about itself. One target held a multi agent orchestration file that spawns fourteen
 * subagents and splices earlier output into later prompts, written against a host DSL with bare globals
 * and no imports, so no adapter claimed it and the sentence above was the line an operator would quote
 * back. It is the strongest sentence in the document and the least supported one.
 *
 * The adapters that ran are named on the row below this, so a reader who wants to know what was looked
 * for has it. This says only that none of them recognised anything.
 */
const NOT_DETECTED_VARIANTS: readonly string[] = [
  'No agent system was detected: no adapter here recognised an agent, a model call, a tool or an MCP server.',
  'No agent system was detected: no adapter here recognised one.',
  'No agent system was detected.',
];

const notDetectedCaveat = (layout: Layout): Row => ({
  kind: 'caveat',
  text:
    NOT_DETECTED_VARIANTS.find((variant) => visibleWidth(variant) <= layout.effective) ??
    (NOT_DETECTED_VARIANTS[NOT_DETECTED_VARIANTS.length - 1] as string),
});

const adapterRoster = (coverage: Coverage, layout: Layout): Row | null => {
  const ran = coverage.adapters.filter((adapter) => adapter.status !== 'not_applicable');
  const silent = coverage.adapters.filter((adapter) => adapter.status === 'not_applicable');
  if (ran.length === 0 && silent.length === 0) return null;
  const names = ran.map((adapter) => adapterName(adapter.adapterId));
  const tail = `, ${silent.length} found nothing to read`;
  const budget =
    layout.effective - (VALUE_COLUMN - 1) - visibleWidth(`${ran.length} ran`) - visibleWidth(tail);
  let shown = names.length;
  const render = (count: number): string => {
    if (count === 0) return '';
    const rest = names.length - count;
    return ` (${names.slice(0, count).join(', ')}${rest === 0 ? '' : ` and ${rest} more`})`;
  };
  while (shown > 0 && visibleWidth(render(shown)) > budget) shown -= 1;
  return { kind: 'keyed', key: 'adapters', text: `${ran.length} ran${render(shown)}${tail}` };
};

export const sourceRegion = (
  result: AuditResult,
  layout: Layout,
  bold: (text: string) => string,
  verbose = false,
): Region => {
  const rows = sourceRows(result, layout, bold, verbose);
  if (result.agentSystemDetected) return rows;
  const caveat = notDetectedCaveat(layout);
  if (!verbose) return [...rows, caveat];
  const roster = adapterRoster(result.graph.coverage, layout);
  return roster === null ? [...rows, caveat] : [...rows, caveat, roster];
};
