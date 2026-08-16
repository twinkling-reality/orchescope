/**
 * What this repository is, and what was read to say so.
 *
 * Line one is the project name and what the project turned out to contain. A bare part count is a size
 * rather than a description: "33 parts found" tells a reader nothing that "5 agents, 7 tools and 2
 * models" does not tell them better, and it leaves the name in column one looking like a mode rather
 * than like the thing being described, which is what "demo" read as. Line two is coverage and how much
 * runtime evidence exists, because a count with no denominator is a claim about a whole nobody
 * measured, and because whether anything has ever run is the fact that decides what the rest of this
 * document is able to say.
 */

import { formatCount } from '@orchescope/domain';
import type { AuditResult } from '@orchescope/usecases';
import { cut, visibleWidth } from './display-width.ts';
import { KEY_WIDTH, type Layout, type Region, type Row, VALUE_COLUMN } from './document-grid.ts';

type Coverage = AuditResult['graph']['coverage'];

const adapterName = (adapterId: string): string => adapterId.replace(/^adapter:/, '');

/**
 * The three kinds a reader of an agent system asks about first.
 *
 * Every supported ecosystem names agents, tools and models; the rest of the graph's vocabulary
 * (prompts, queues, entry points, memories) is either an implementation detail of one of those or a
 * word a reader would have to be taught. A project with none of the three falls back to the part count,
 * because naming zero of everything is worse than naming a size.
 */
const HEADLINE_KINDS = ['agent', 'tool', 'model'] as const;

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
  const named = HEADLINE_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [formatCount(count, kind)];
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
  return [`this project has ${found}`, found];
};

const runsPhrase = (result: AuditResult): string => {
  const runs = result.bundle.summary.runCount ?? 0;
  return runs === 0 ? 'no runs on record' : `${formatCount(runs, 'run')} on record`;
};

const coverageVariants = (result: AuditResult, verbose: boolean): readonly string[] => {
  const coverage = result.graph.coverage;
  const supported = coverage.filesInSupportedLanguages ?? coverage.filesParsed;
  const files = `${coverage.filesParsed} of ${formatCount(supported, 'file')}`;
  const runs = runsPhrase(result);
  const graph = `${formatCount(result.bundle.summary.componentCount, 'part')} and ${formatCount(result.bundle.summary.edgeCount, 'link')}`;
  if (!verbose) return [`read from ${files}, with ${runs}`, `read from ${files}`];
  return [
    `${graph}; ${files} read; ${runs}`,
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

const NOT_DETECTED_VARIANTS: readonly string[] = [
  'No agent system was detected: nothing looked like an agent, a model call, a tool or an MCP server.',
  'No agent system was detected: nothing looked like an agent, tool, or model.',
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
