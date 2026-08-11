/**
 * What this repository is, and what was read to say so.
 *
 * One line when an agent system was found, three when none was, and the two extra lines are a refusal
 * rather than a decoration: the caveat says what was looked for and did not appear, and the roster says
 * which readers found nothing, so a reader can tell an unsupported ecosystem apart from an empty one.
 *
 * Nothing here is analysed. Every count was decided by the scan that wrote the coverage record, and
 * this module chooses which of them fit and in what order they are shed.
 */

import { formatCount } from '@orchescope/domain';
import type { AuditResult } from '@orchescope/usecases';
import { cut, visibleWidth } from './display-width.ts';
import { KEY_WIDTH, type Layout, type Region, type Row, VALUE_COLUMN } from './document-grid.ts';

type Coverage = AuditResult['graph']['coverage'];

const adapterName = (adapterId: string): string => adapterId.replace(/^adapter:/, '');

/**
 * The count tail, longest first, each variant carrying its own short form.
 *
 * Degrading is a choice of index rather than a rewrite, which is what stops a narrow terminal getting a
 * sentence nobody ever read. The denominator of the files read is the files in a language this build
 * parses, never the files the walk touched: the walk counts JSON, YAML and TOML so that configuration
 * adapters can read them, and none of the three is parsed as source, so dividing by the walk reports a
 * repository whose every readable file was read as partly read.
 */
const countVariants = (result: AuditResult): readonly string[] => {
  const summary = result.bundle.summary;
  const coverage = result.graph.coverage;
  const supported = coverage.filesInSupportedLanguages ?? coverage.filesParsed;
  const components = formatCount(summary.componentCount, 'component');
  const edges = formatCount(summary.edgeCount, 'edge');
  return [
    `${components}, ${edges}, ${coverage.filesParsed} of ${formatCount(supported, 'file')} read`,
    `${components}, ${edges}`,
    components,
  ];
};

/**
 * The project name is the key, and it is the one key allowed to overhang its column.
 *
 * A repository called `vercel-ai-chatbot-exercised` is twenty seven columns and truncating it would
 * make two repositories with a shared prefix produce the same first line. It pushes its own value right
 * and nothing else on the page moves.
 *
 * It overhangs to a ceiling and not without one. The name is the directory the audit ran in or the
 * `projectName` a configuration file set, both of them strings this repository treats as untrusted, so
 * a key that never cuts is a line whose width the audited repository chooses.
 *
 * The ceiling is derived from what the key is a key to: the name may take the line as far as still
 * leaves room for the shortest count, and no further. That bounds the row and makes the count
 * unloseable in the same stroke, because the shortest variant then fits by construction and a
 * measurement can never fall off the line without saying so. The longest name in the pinned corpus is
 * twenty seven columns against a ceiling of forty five at sixty, so nothing measured here is cut.
 */
const sourceHeadline = (
  result: AuditResult,
  layout: Layout,
  bold: (text: string) => string,
): Row => {
  const variants = countVariants(result);
  const shortest = variants[variants.length - 1] ?? '';
  const key = cut(result.bundle.projectName, layout.effective - visibleWidth(shortest) - 2);
  const start = Math.max(KEY_WIDTH, visibleWidth(key)) + 2;
  const chosen =
    variants.find((variant) => start + visibleWidth(variant) <= layout.effective) ?? shortest;
  return { kind: 'keyed', key, text: chosen, paintKey: bold };
};

/**
 * The refusal, in three registered forms, and it is never replaced by a blank line.
 *
 * `No agent system was detected` is the sentence three surfaces and two end to end tests agree on, so
 * every form opens with it verbatim and the forms differ only in how much of the list of things that
 * would have counted survives. The shortest form fits any terminal this document renders in.
 */
const NOT_DETECTED_VARIANTS: readonly string[] = [
  'No agent system was detected: nothing declared an agent, a model call, a tool or an MCP server.',
  'No agent system was detected: nothing declared an agent, a tool or a model call.',
  'No agent system was detected.',
];

const notDetectedCaveat = (layout: Layout): Row => ({
  kind: 'caveat',
  text:
    NOT_DETECTED_VARIANTS.find((variant) => visibleWidth(variant) <= layout.effective) ??
    (NOT_DETECTED_VARIANTS[NOT_DETECTED_VARIANTS.length - 1] as string),
});

/**
 * Who read, and who found nothing to read.
 *
 * The roster sheds whole names and never truncates one: half an adapter name is a name that matches no
 * adapter. The two counts are never shed, because the counts are the claim and the names are the
 * evidence for it. The list was a hundred and twenty nine columns on every repository where no system
 * was found, which is the one place a reader most needs the line to be readable.
 */
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
): Region => {
  const headline = sourceHeadline(result, layout, bold);
  if (result.agentSystemDetected) return [headline];
  const roster = adapterRoster(result.graph.coverage, layout);
  return roster === null
    ? [headline, notDetectedCaveat(layout)]
    : [headline, notDetectedCaveat(layout), roster];
};
