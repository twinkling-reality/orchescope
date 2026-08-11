/**
 * Every report state, as pages you can open.
 *
 * The browser workspace does not render one fixed page. Each screen picks a representation from what the
 * bundle can carry and says which one it picked, so "what does this screen look like" has no single
 * answer and cannot be settled by looking at the demonstration. Anyone changing the interface needs to
 * see the range, not one point in it.
 *
 * Every bundle under `corpus/.cache/bundles` is a real report of a real repository, produced by
 * `pnpm corpus`. This renders each one as a standalone page, the same single file export the product
 * already ships, and writes an index that says which states each bundle reaches. Opening the index and
 * clicking through is the whole tool.
 *
 * The flags in the index are computed from the bundle rather than described, because a note that says a
 * bundle crosses a ceiling is wrong the moment the ceiling moves. The thresholds are imported from the
 * modules that own them for the same reason.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'apps/web/dist');
const defaultSource = join(root, 'corpus/.cache/bundles');
const defaultOut = join(root, 'states');

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const source = resolve(argument('--from') ?? defaultSource);
const out = resolve(argument('--out') ?? defaultOut);

const missing = ['app.js', 'app.standalone.css'].filter((file) => !existsSync(join(assets, file)));
if (missing.length > 0) {
  process.stderr.write(
    `apps/web/dist is missing ${missing.join(' and ')}.\nRun pnpm build:web first.\n`,
  );
  process.exit(1);
}
if (!existsSync(source)) {
  process.stderr.write(
    `No bundles at ${source}.\nRun pnpm corpus to produce them, or pass --from <directory>.\n`,
  );
  process.exit(1);
}

const { renderStandaloneHtml } = await import(join(root, 'packages/report/src/exports.ts'));
const { bakeLayouts, MAP_LAYOUT_KEYS, MAP_LAYOUTS_KEY } = await import(
  join(root, 'packages/report/src/layouts.ts')
);
const { CELL_LIMIT, DENSE_ABOVE } = await import(join(root, 'apps/web/src/delta-meter.ts'));
const { MAP_LAYOUT_KEYS: WEB_LAYOUT_KEYS } = await import(join(root, 'apps/web/src/layout.ts'));
const { nameRoom } = await import(join(root, 'apps/web/src/map-names.ts'));

/**
 * The canvas the flags below describe, and sigma's own mapping into it.
 *
 * The workspace never computes this: it asks the renderer where a point lands. This script has no
 * renderer, so it reimplements the mapping from `sigma/dist/normalization`, where the drawing is
 * normalised by its longer side and scaled to the smaller side of the canvas less the stage padding.
 * It is here to label a gallery, not to decide what is drawn, and a report opened at another window
 * width will name a different number of things.
 */
const CANVAS = { width: 920, height: 640 };
const STAGE_PADDING = 30;
const MARGIN = 0.06;

const fittedScale = (points) => {
  if (points.length === 0) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const spread = Math.max(width, height, 1);
  const framed = { width: width + spread * MARGIN * 4, height: height + spread * MARGIN * 2 };
  const viewportRatio = CANVAS.height / CANVAS.width;
  const graphRatio = framed.height / framed.width;
  const correction =
    (viewportRatio < 1 && graphRatio > 1) || (viewportRatio > 1 && graphRatio < 1)
      ? 1
      : Math.min(Math.max(graphRatio, 1 / graphRatio), Math.max(1 / viewportRatio, viewportRatio));
  const smallest = Math.min(CANVAS.width, CANVAS.height) - 2 * STAGE_PADDING;
  return (smallest * correction) / Math.max(framed.width, framed.height);
};

/** The names the concentric arrangement draws, which is the one every bundle carries. */
const drawnNames = (bundle) => {
  const names = [];
  for (const component of bundle.graph.components) {
    const x = component.metadata?.['layoutX'];
    const y = component.metadata?.['layoutY'];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    names.push({ x, y, chars: component.displayName.length });
  }
  return names;
};

const naming = (bundle) => {
  const names = drawnNames(bundle);
  const scale = fittedScale(names);
  const room = nameRoom(names);
  return { names: names.length, scale, room };
};

/**
 * The two sides of the layout seam agree on where the coordinates live.
 *
 * The command line tool writes them and the browser reads them, and the two cannot import each other:
 * `apps/web` may only share the schema package. This is the one process that loads both, so it is the
 * one place the key names can be checked rather than trusted.
 */
const bakedKeys = JSON.stringify(MAP_LAYOUT_KEYS);
const readKeys = JSON.stringify(WEB_LAYOUT_KEYS);
if (bakedKeys !== readKeys) {
  process.stderr.write(
    `The layout keys the CLI bakes and the ones the browser reads have drifted apart.\n  baked: ${bakedKeys}\n  read:  ${readKeys}\n`,
  );
  process.exit(1);
}

const javascript = readFileSync(join(assets, 'app.js'), 'utf8');
const css = readFileSync(join(assets, 'app.standalone.css'), 'utf8');

/**
 * Whether a stored bundle was laid out by this build.
 *
 * Map coordinates are computed once, in the process that writes the bundle, so that the same graph gives
 * the same map on every machine. That also means a stored bundle carries the layout of whatever build
 * wrote it, and rendering old coordinates with a new canvas produces a picture that is wrong in a way
 * nothing on the page admits to: the layered coordinates this repository used before the ring layout put
 * every component of a large repository on three x values, which the current canvas draws as a vertical
 * column of overlapping dots. A reader cannot tell that from a system that really is a column.
 *
 * The layout is a pure function of the graph, so recomputing it and comparing settles the question. A
 * bundle that fails is not rendered at all, because a broken map read as a finding is worse than a
 * missing page.
 *
 * A bundle can now carry more than one arrangement, so the comparison has to know which one it is
 * comparing: every arrangement this build produces is recomputed against its own keys. A bundle written
 * before the directional arrangements existed carries only the concentric coordinates, and that is not
 * staleness. It is a bundle with one arrangement in it, and the picker is absent rather than broken, so
 * only the arrangements the bundle actually carries are checked.
 */
const laidOutByThisBuild = (bundle) => {
  const fresh = bakeLayouts(bundle.graph);
  for (const layout of fresh) {
    const keys = MAP_LAYOUT_KEYS.find((candidate) => candidate.kind === layout.kind);
    if (keys === undefined) continue;
    const carried = bundle.graph.components.some(
      (component) => component.metadata?.[keys.x] !== undefined,
    );
    if (!carried) continue;
    for (const component of bundle.graph.components) {
      const position = layout.positions.get(component.id);
      const bakedX = component.metadata?.[keys.x];
      const bakedY = component.metadata?.[keys.y];
      if (position === undefined) {
        if (bakedX !== undefined) return false;
        continue;
      }
      if (typeof bakedX !== 'number' || typeof bakedY !== 'number') return false;
      if (Math.abs(position.x - bakedX) > 0.5 || Math.abs(position.y - bakedY) > 0.5) return false;
    }
  }
  return true;
};

/**
 * What a bundle can show, decided from the bundle.
 *
 * Each entry is a state a reader can be in, and the predicate is the same one the workspace uses. A
 * bundle reaching none of these is not useless: it is the empty state of everything it is missing, which
 * is a state too, and the index says so.
 */
const REACHES = [
  ['no components at all', (b) => b.graph.components.length === 0],
  ['a run to compare against', (b) => b.runs.length > 0],
  ['no run, so nothing is drawn as unexercised', (b) => b.runs.length === 0],
  ['the delta rail as one cell per component', (b) => hasDelta(b) && declared(b) <= CELL_LIMIT],
  ['the delta rail as a proportion', (b) => hasDelta(b) && declared(b) > CELL_LIMIT],
  ['the delta rail with its gaps closed', (b) => hasDelta(b) && declared(b) > DENSE_ABOVE],
  [
    'the map naming every component at the fitted view',
    (b) => {
      const state = naming(b);
      return state.names > 0 && state.scale >= state.room.nameEvery;
    },
  ],
  [
    'the map naming what it has room for and leaving the rest out',
    (b) => {
      const state = naming(b);
      return (
        state.names > 0 && state.scale >= state.room.nameSome && state.scale < state.room.nameEvery
      );
    },
  ],
  [
    'the map declining to name until it is zoomed into',
    (b) => {
      const state = naming(b);
      return state.names > 0 && state.scale < state.room.nameSome;
    },
  ],
  [
    'the map offering more than one arrangement',
    (b) => (b.graph.metadata?.[MAP_LAYOUTS_KEY] ?? []).length > 1,
  ],
  ['the map admitting what it left out', (b) => drawn(b) < b.graph.components.length],
  ['strengths as well as risks', (b) => (b.summary?.strengthCount ?? 0) > 0],
  ['no finding at all', (b) => b.findings.length === 0],
  ['per component measurements', (b) => (b.componentMetrics ?? []).length > 0],
  ['a benchmark', (b) => (b.benchmarks ?? []).length > 0],
  ['a chaos run', (b) => (b.chaosReports ?? []).length > 0],
  ['a comparison', (b) => (b.comparisons ?? []).length > 0],
  ['a goal', (b) => (b.goals ?? []).length > 0],
  ['a goal this report judged', (b) => (b.goalValidations ?? []).length > 0],
  [
    'a scenario defined and never run',
    (b) => (b.scenarios ?? []).length > 0 && (b.scenarioRuns ?? []).length === 0,
  ],
  ['a scenario with runs', (b) => (b.scenarioRuns ?? []).length > 0],
  ['files it could not read', (b) => (b.graph.coverage?.skipped ?? []).length > 0],
  ['a file it could not read at all', (b) => (b.graph.coverage?.unsupported ?? []).length > 0],
];

const hasDelta = (bundle) => bundle.reconciliation !== undefined;
const declared = (bundle) =>
  bundle.reconciliation?.coverage.declaredComponents ?? bundle.graph.components.length;
/**
 * How many components the map draws, taken from the layout rather than re-derived.
 *
 * Counting the endpoints of every edge is the obvious derivation and it is wrong: an edge can name a
 * component the graph does not carry, and 104 of crewai's 243 do. The layout is what the canvas reads,
 * so it is what this counts, and the number agrees with the census the map prints about itself.
 */
const drawn = (bundle) =>
  bundle.graph.components.filter((component) => component.metadata?.['layoutX'] !== undefined)
    .length;

const asText = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

mkdirSync(out, { recursive: true });

const files = readdirSync(source)
  .filter((file) => file.endsWith('.json'))
  .sort();
if (files.length === 0) {
  process.stderr.write(`No .json bundles in ${source}.\n`);
  process.exit(1);
}

const rows = [];
const stale = [];
for (const file of files) {
  const name = file.replace(/\.json$/, '');
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(join(source, file), 'utf8'));
  } catch (error) {
    process.stderr.write(`skipped ${file}: ${error.message}\n`);
    continue;
  }
  if (bundle.graph === undefined) {
    process.stderr.write(`skipped ${file}: not a report bundle\n`);
    continue;
  }
  if (!laidOutByThisBuild(bundle)) {
    stale.push(name);
    continue;
  }
  rows.push({
    name,
    page: `${name}.html`,
    bundle,
    project: bundle.projectName,
    components: bundle.graph.components.length,
    drawn: drawn(bundle),
    findings: bundle.findings.length,
    runs: bundle.runs.length,
    reaches: REACHES.filter(([, predicate]) => predicate(bundle)).map(([label]) => label),
  });
}

rows.sort((left, right) => left.components - right.components);

/*
 * Every page is written knowing what else was written, so the chrome can offer a picker instead of
 * sending a reader back to an index to change report. The list is a JSON island exactly like the
 * bundle beside it, which is data rather than script and so needs nothing from the policy: the two
 * hashes pin the module and the stylesheet, and neither of them changed.
 *
 * A report produced by the real command carries no such island, so the picker is absent there. That is
 * the boundary rather than an omission: one report is one repository at one revision, and offering to
 * switch to another would offer something the analysis behind it cannot support.
 */
const galleryFor = (current) =>
  JSON.stringify(
    rows.map((row) => ({
      page: row.page,
      project: row.project,
      components: row.components,
      runs: row.runs,
      current: row.page === current,
    })),
  ).replace(/<\//g, '<\\/');

const REPORT_ISLAND = '<script type="application/json" id="orchescope-report">';

for (const row of rows) {
  const html = renderStandaloneHtml(row.bundle, {
    javascript,
    css,
    title: `Orchescope report for ${row.project}`,
  });
  if (!html.includes(REPORT_ISLAND)) {
    process.stderr.write(
      'The standalone export no longer carries the report island this script writes beside.\n',
    );
    process.exit(1);
  }
  writeFileSync(
    join(out, row.page),
    html.replace(
      REPORT_ISLAND,
      `<script type="application/json" id="orchescope-gallery">${galleryFor(row.page)}</script>\n${REPORT_ISLAND}`,
    ),
  );
}

/** Which states no bundle reaches. Named rather than left as a silence, because they are the gaps to fill. */
const covered = new Set(rows.flatMap((row) => row.reaches));
const uncovered = REACHES.map(([label]) => label).filter((label) => !covered.has(label));

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orchescope report states</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 40px; max-width: 68rem; }
  h1 { font-size: 20px; font-weight: 500; margin: 0 0 4px; }
  p { color: #666; max-width: 60ch; }
  table { border-collapse: collapse; width: 100%; margin-top: 24px; }
  th, td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid #8884; vertical-align: top; }
  th { font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; }
  ul { margin: 0; padding-left: 16px; color: #666; font-size: 13px; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Orchescope report states</h1>
<p>One page per real report. Each is the single file export, so it opens with no server. The states
column is computed from the bundle, not described, and lists what that report can show you that the
others cannot.</p>
<table>
<thead><tr><th>Report</th><th>Components</th><th>Drawn</th><th>Findings</th><th>Runs</th><th>What it reaches</th></tr></thead>
<tbody>
${rows
  .map(
    (row) => `<tr>
<td><a href="${asText(row.page)}">${asText(row.name)}</a></td>
<td class="num">${row.components}</td>
<td class="num">${row.drawn}</td>
<td class="num">${row.findings}</td>
<td class="num">${row.runs}</td>
<td><ul>${row.reaches.map((label) => `<li>${asText(label)}</li>`).join('')}</ul></td>
</tr>`,
  )
  .join('\n')}
</tbody>
</table>
${
  uncovered.length === 0
    ? ''
    : `<h1 style="margin-top:40px">Reached by no report here</h1>
<p>States the workspace can be in that none of these bundles produces. Nothing shows them today.</p>
<ul>${uncovered.map((label) => `<li>${asText(label)}</li>`).join('')}</ul>`
}
</body>
</html>
`;

writeFileSync(join(out, 'index.html'), index);

process.stdout.write(`\nWrote ${rows.length} report(s) to ${out.replace(`${root}/`, '')}\n`);
for (const row of rows) {
  process.stdout.write(
    `  ${row.name.padEnd(30)} ${String(row.components).padStart(5)} components, ${row.reaches.length} state(s)\n`,
  );
}
if (uncovered.length > 0) {
  process.stdout.write(`\n${uncovered.length} state(s) no bundle here reaches:\n`);
  for (const label of uncovered) process.stdout.write(`  ${label}\n`);
}
if (stale.length > 0) {
  process.stdout.write(
    `\n${stale.length} bundle(s) were laid out by an older build and were not rendered:\n`,
  );
  for (const name of stale) process.stdout.write(`  ${name}\n`);
  process.stdout.write('Run pnpm corpus to audit those repositories again with this build.\n');
}
process.stdout.write(`\nOpen ${join(out, 'index.html').replace(`${root}/`, '')}\n`);
