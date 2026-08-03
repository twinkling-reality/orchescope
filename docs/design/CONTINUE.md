# Continuing the report workspace

Working instructions for the next session on `apps/web`. The design record is
[report-system.md](report-system.md); this is the orientation that goes with it.
[BRIEF.md](BRIEF.md) is the brief that started the redesign, kept for the reasoning it carries.

**Before designing anything, read [states/README.md](states/README.md) and run `pnpm states`.** The
workspace renders 1128 distinct states across its eight screens and the demonstration is one point in
that space. The gallery renders every cached report as a page you can open, and the files beside that
README list every state, the data predicate that selects it, the branch it lives on, and which report
shows it. 462 of the 1128 are reached by no report in the cache, so nothing has ever been looked at in
them.

I want to keep working on the browser report workspace in `apps/web`. Work in
`/Users/glendonchin/dev/Technology/orchescope`.

**Read first:** `AGENTS.md` for the hard rules, `docs/design/report-system.md` for what the workspace is
built from and why, and phase 20 in `PLANS.md` for what was measured. Then run `pnpm build:web` and
`pnpm orchescope --cwd apps/demo audit --serve` and look at the real page before changing anything.
`pnpm tour` gives you a report with runtime data in it.

A design pass has just been completed. It is green: `pnpm verify` at 765 unit and integration tests and
92 end to end, and `pnpm test:ui` at 16 browser tests.

## The distinction I need you to hold onto

There are two layers and they are governed differently. Do not blur them.

### Layer one: the design system. Fixed, and identical in every report.

Defined once in `apps/web/src/styles.css` and `apps/web/src/ui/primitives.tsx`. It does not vary with
the data, the repository or the reader.

- **Two families.** Manrope for prose, JetBrains Mono for every number. Vendored in
  `apps/web/src/fonts/`, latin subset, variable, SIL OFL with the licence text shipped beside them.
- **Eight neutrals, two alert hues and one accent.** The alert hues appear on a severity marker and
  the word beside it and nowhere else, ever.
- **One idea: fill means evidence.** A filled shape was measured in a run, a hollow outline was only
  declared. It holds on the delta bar, the map nodes, the components table and the severity marker.
- **Weight is a function of size.** Sans 200 only at 24px and up, 300 from 16 to 23, 400 body, 500
  headings. Mono 300 at 16 and up, 400 below.
- **Spacing** 4, 8, 12, 16, 24, 40, 64. One radius at 2px. One measure at 68ch, one tool rail at
  264px and one bento row at 300px. There is no `--column`: the bento is full bleed at every width.
- **One accent, on the chrome and never on the data.** `--accent`, one blue, on focus, selection,
  checked filters, links and the two menu edges. Never a bar cell, a map node, a presence mark, a
  severity marker or a number. Where you are is not the accent: the current section is a filled pill
  in `--ink`.
- **A chrome of three zones on one row.** The mark, a `/` and the project name on the left, the eight
  screens as pills centred on the page, two icons on the right. Which report, which scan and which
  revision are behind the first icon rather than set across the top of every screen.
- **A screen is a bento, and there is no page ground.** Twelve columns, `gap: 0`, one hairline between
  neighbours rather than a gutter of page showing through. Four places: `.tile` spans the row and is
  the band or an evidence table, `.tile.is-anchor` is four of twelve and the dark ground,
  `.tile.is-stage` is five, and `.tile-stack` is three and holds one to three short tiles. Each tile
  summarises with its detail behind a `···`.
- **A tile owns its ground, by swapping the neutrals inside itself.** Every rule that draws from them
  comes across intact and fill still means evidence on the other ground, canvas included. Three
  grounds: anchor, band, field. The band holds a statement and never an unbounded list, and every
  screen's refusal state is the band, because when there is nothing to show the refusal is the
  statement.
- **There is no theme.** All three grounds are fixed by role: light band on top, black anchor in the
  corner, light field everywhere else. A dark palette cannot hold three grounds apart at all, and that
  is arithmetic rather than taste: 3:1 against a near black anchor needs a mid grey. A version that
  fixed only the anchor and themed the other two was built and rejected on sight, because two grounds
  inside 1.13:1 of each other is the same grey rectangle with one fewer participant. With no page
  ground left there was nothing for the control to act on, so it is gone.
- **Width is a bento, not a wider paragraph.** Prose stays at 68ch and a tile's inset grows with the
  viewport, so a wider window gives a tile more air rather than a longer line. `.workbench` puts
  controls beside what they control on the evidence screens, which scroll on purpose.
- **Ten primitives** and every screen is assembled from them: `Eyebrow`, `Display`, `Figure`, `Data`,
  `BasisChip`, `SeverityMark`, `BarCell`, `RuledStat`, `DisclosureRow`, `RefusalPanel`. A handful of
  supporting exports sit beside them in the same file (`DeclarationBar`, `EvidenceKey`, `StatRow`,
  `CommandBlock`, `Meta`, `DefinitionList`, `MeasureBar`, `OptionalNumber`, `State`) and are
  compositions or plumbing rather than new vocabulary.

**If you need a style that is not in that set, that is a signal to stop and argue for it, not to add
it.** The set was chosen to be small on purpose.

### Layer two: what the page decides from the data. Varies per report, and every variation is stated.

This is the part that confused me and it is the more interesting half. The workspace does not render
one fixed page. It picks a representation from what the data can carry, and it says which one it
picked. The rule throughout: **never draw something that implies more than was measured, and when you
change how you are drawing, say so in the same breath.**

Every one of these lives in a pure, tested module rather than inside a component:

| decision | where | how it varies |
| --- | --- | --- |
| Delta bar cells | `delta-bar.ts`, `CELL_LIMIT = 120`, `DENSE_ABOVE = 48` | At or below 120 declared components one cell is one component. Above it, 120 cells carry the proportion and the caption says what one cell now stands for. Gaps close above 48. A non zero count never rounds to nothing. |
| The headline sentence | `headline.ts` | Five different sentences depending on whether anything is declared, whether anything never ran, and whether anything ran undeclared. Counts up to twelve are spelled, above that a numeral in mono. |
| Which components the map draws | `packages/report/src/layout.ts` | Only components a relation touches get coordinates. In `openai-agents-python` that is 298 of 1390. |
| What the map admits it left out | `map-census.ts` | Per kind, worst first, and nothing at all when the map drew everything. |
| Whether the map names things | `map-names.ts`, `NAMEABLE_CEILING = 120` | Decided from the drawn count and the camera together, because the ceiling is about room: `drawn * ratio <= 120`. At the fitted view a small graph is named in full and a large one draws shape and says which magnification will name it. Zooming in halves the effective count and the names arrive. What you select is named at any size. |
| Presence marks | `ui/presence.tsx` | Four states, and the fourth matters most: a report with no run says `no run to compare` with a dashed mark rather than claiming nothing was exercised. |
| Navigation counts | `ui/shell.tsx` | Shown above zero, omitted at zero, because the section itself refuses in a sentence that says more. |
| Filter options | `filters.ts` and the sections | Only severities, categories, bases and kinds actually present in this bundle appear. |
| Overlays | `overlay.ts` | Only the overlay kinds the bundle carries. A measured value fills, an absent one stays hollow. |
| Actions | `capabilities.ts` | Undeclared capability means no control at all. Declared but unavailable means a disabled control with the server's own reason beside it. |
| Empty and refusal states | every section | Each screen has one, and it names the command that would produce the missing evidence. |

The ceilings are derived, not chosen by taste, and the derivations are in the comments. The map's 120
comes from arithmetic: the outermost ring in a canvas of height H has radius at most H/2, so two
neighbours have at most `2 * pi * (H / 2) / k` pixels between them, about `2200 / k` here, and a name
needs about 16 of them.

## Hard constraints, all currently enforced

- CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
  connect-src 'self'` in `packages/report-server/src/security.ts`. The standalone export in
  `packages/report/src/exports.ts` is the one exception and carries `font-src data:` for the faces it
  inlines. No remote assets anywhere, no `unsafe-inline`.
- `apps/web` may import only `@orchescope/schema`, and only for types. `pnpm deps` fails otherwise.
- Untrusted text reaches the page as a text node. No `innerHTML`. An inline style is only ever a CSS
  custom property.
- A control the configuration cannot perform is disabled with its reason shown, or absent.
- Every displayed number carries its basis.
- No `TODO`, no placeholder implementations, no em dash characters anywhere.
- Layout coordinates are computed in the CLI and baked into the bundle, so the same graph gives the same
  map on every machine. Whatever you change, that determinism has to survive.

## What must still pass

`pnpm verify`, `pnpm test:ui` and `pnpm package`. The browser tests assert behaviour rather than
appearance: every section reachable, the map's table carrying the same components as the canvas, filters
narrowing both, a finding showing its basis and evidence, an unavailable action explaining itself, no
request to another origin, the shortcut panel by keyboard, the composition not following the operating
system,
navigation by landmarks and headings, visible keyboard focus, reduced motion respected, and no sideways
scrolling at 390px. If markup changes force a test change, change it deliberately and say so. Do not
weaken what it asserts.

Measure against the corpus, not the demonstration. `apps/demo` has 33 components and is the small,
dense, unrepresentative case. `corpus/.cache` holds real checkouts; `openai-agents-python` has 1390
components with 226 relations and `langgraphjs` has 709 with 659. Anything that only works at 33 is not
finished.

## Where I would like to go next

I have not decided, so treat these as candidates rather than instructions, and push back if the evidence
says something else is more valuable:

1. **Two hop adjacency on the map.** The one thing a picture adds over the details panel is seeing two
   agents converge on one tool, and that is a two hop property. It was deliberately not built, because
   the evidence for it has not been gathered. Gather it before building it.
2. **The bento's row is 300px and nothing measured that.** It is the one number in the tile system
   that is taste. What would settle it is the `scrollHeight` of each screen across the sixteen reports
   at a few window heights, against how much of the summary a reader can see without scrolling.
3. **Every screen with runtime data in it has been seen exactly once, on `demo-populated`.** That is
   one run shape: ten runs, one benchmark, one chaos run, one comparison, two goals. A report with a
   failed benchmark variant, a chaos run that applied nothing, or a comparison with a real verdict has
   never been drawn. `pnpm tour` is the way to make one.
4. **The state tables under `states/` are stale for six screens.** The gallery is not, because it
   renders whatever the build produces. See [states/README.md](states/README.md).

Start by looking at the real page with real data before you propose anything.
