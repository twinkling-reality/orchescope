# Continuing the report workspace

Working instructions for the next session on `apps/web`. The design record is
[report-system.md](report-system.md); this is the orientation that goes with it.
[BRIEF.md](BRIEF.md) is the brief that started the redesign, kept for the reasoning it carries.

**Before designing anything, read [states/README.md](states/README.md) and run `pnpm states`.** The
gallery renders every cached report as a page. Use it to compare the fixed skeleton across no-run,
runtime and goal-bearing reports, and to catch honest refusals that the demonstration does not show.
The state tables beside the README are a historical branch inventory and a regression aid, not the
product's presentation model or a target to expand.

I want to keep working on the browser report workspace in `apps/web`. Work in
`/Users/glendonchin/dev/Technology/orchescope`.

**Read first:** `AGENTS.md` for the hard rules, `docs/design/report-system.md` for what the workspace is
built from and why, and phase 20 in `PLANS.md` for what was measured. Then run `pnpm build:web` and
`pnpm orchescope --cwd apps/demo audit --serve` and look at the real page before changing anything.
`pnpm tour` gives you a report with runtime data in it.

The workspace has a fixed presentation contract. Overview always renders headline, top actions, next
commands, context and join. Every other screen always renders summary, primary and detail. Re-run the gates
below rather than relying on historical test counts.

## The distinction I need you to hold onto

There are two layers and they are governed differently. Do not blur them.

### Layer one: the design system. Fixed, and identical in every report.

Defined in the responsibility-named files under `apps/web/src/styles/` and in
`apps/web/src/ui/primitives.tsx`. `styles.css` is only the import manifest. Pure binders that decide
what each slot holds live under `apps/web/src/presentation/` and must not import `ui/` or `sections/`;
`pnpm deps` enforces that so the skin can be replaced without rewriting decisions. The system does not
vary with the data, the repository or the reader.

- **Two families.** Manrope for prose, JetBrains Mono for every number. Vendored in
  `apps/web/src/fonts/`, latin subset, variable, SIL OFL with the licence text shipped beside them.
- **Eight neutrals, two alert hues and one accent.** The alert hues appear on a severity marker and
  the word beside it and nowhere else, ever.
- **One idea: fill means evidence.** A filled shape was measured in a run, a hollow outline was only
  written down. It holds on the rail, the map nodes, the table of parts and the severity marker. Two
  states take a dashed mark instead of a hollow one, because neither can be drawn either way: a report
  with no run, and a kind no trace records.
- **The words are the reader's, and the six evidence words are the exception.** `Observed`,
  `Discovered`, `Inferred`, `Estimated`, `Simulated` and `Model interpreted` are the closed vocabulary
  the whole product rests on and no plain substitute keeps the six apart, so they stay and the gloss
  sits beside them. Everything else says what a person would say out loud: a part rather than a
  component, a connection rather than a relation, seen running rather than exercised, a problem rather
  than a risk, written down rather than declared. `delta`, `reconciliation`, `polarity`, `basis`,
  `goal readiness`, `presence`, `chaos run` and `amplification` are gone from the page.
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
- **Four ranks, and a `···` may hold the last one only.** The answer, then the working set, then the
  evidence behind one row of it, then protocol depth. A working set behind a menu is not a working set,
  which is what forced this pass: `Fix this first` used to show one of three ranked risks and hide the
  rest beside the evidence vocabulary.
- **A depth screen opens on the question it answers, the answer, and one measure beside it.**
  `styles/section-lead.css`. No screen repeats its own tab name in ten pixel capitals under the
  navigation that already highlights it; the hidden `h2` names it for assistive technology.
- **A screen has fixed slots, filled with bento tiles.** Overview owns four ordered slots; every depth
  screen owns three. Twelve columns, `gap: 0`, and one hairline between neighbours still define the
  tile composition inside them. A missing measurement fills its slot with a refusal instead of
  changing the page tree.
- **A tile owns its ground, by swapping the neutrals inside itself.** Every rule that draws from them
  comes across intact and fill still means evidence on the other ground, canvas included. Three
  grounds: anchor, band, field, and the band has a second, deeper tone used only for the lower half of
  the Overview hero, because a lower ground lighter than its upper one reads as the colour running out
  and a white one reads as a gap between the tiles above and below it. The chrome is the band's own
  colour and draws no rule under itself. The band holds a statement and never an unbounded list, and every
  screen's refusal state is the band, because when there is nothing to show the refusal is the
  statement.
- **There is no theme.** All three grounds are fixed by role: light band on top, black anchor in the
  corner, light field everywhere else. A dark palette cannot hold three grounds apart at all, and that
  is arithmetic rather than taste: 3:1 against a near black anchor needs a mid grey. A version that
  fixed only the anchor and themed the other two was built and rejected on sight, because two grounds
  inside 1.13:1 of each other is the same grey rectangle with one fewer participant. With no page
  ground left there was nothing for the control to act on, so it is gone.
- **Width is a bento, not a wider paragraph.** Prose stays at 68ch and a tile's inset grows with the
  viewport, so a wider window gives a tile more air rather than a longer line. Overview is not locked to
  the viewport: that lock is what pushed its working set into menus and sized the rail's marks from the
  leftover height. Above 1180px its second row stretches into whatever the first leaves, so a wide
  screen is filled by tiles rather than by page under them. `.workbench` puts controls beside what they
  control on the evidence screens, which scroll on purpose.
- **The Overview leads with what the report found, not with how much of the system a run reached.**
  A count of problems is a fact about the reader's system; `7 of 21 never ran` is a fact about the
  quality of our own measurement, and no wording made it worth reading first. The toggle between
  problems and things done well is the bundle's own polarity and it changes the whole hero. The join is
  a full width tile under the working set, unchanged and still pinned to a revision.
- **Say what the report did before any number.** Every count is meaningless to a reader who does not
  know the tool read their code and, where a run exists, watched the system work. `We read your code,
  then watched your system run 10 times.` goes first, on every regime.
- **The join hero is two grounds and a full bleed rail across the seam.** The gap leads, the four
  sets flank it and every one of them opens the map, and the rail divides whatever width it is given
  evenly so no cell is ever cut and no window empties the picture. It is 34px tall with square corners
  and hairline gaps, because at 68px with a radius the cells stopped being divisions of one measurement
  and became a row of boxes. The layering carries no reading,
  which is why the join can have it: there is no magnitude, no sequence and no trend for a composition
  to imply.
- **Nine primitives** and every screen is assembled from them: `Eyebrow`, `Figure`, `Data`,
  `BasisChip`, `SeverityMark`, `Meter`, `RuledStat`, `DisclosureRow`, `RefusalPanel`. A handful of
  supporting exports sit beside them in the same file (`DeclarationBar`, `EvidenceKey`, `StatRow`,
  `CommandBlock`, `Meta`, `DefinitionList`, `MeasureBar`, `OptionalNumber`, `State`) and are
  compositions or plumbing rather than new vocabulary.

**If you need a style that is not in that set, that is a signal to stop and argue for it, not to add
it.** The set was chosen to be small on purpose.

### Layer two: what fills each slot. Varies per report, and every variation is stated.

The outer page is fixed. Within each named slot, the workspace picks a representation from what the
bundle can carry and says which one it picked. The rule throughout: **never draw something that implies
more than was measured, and when evidence is absent refuse in the same place.**

Every one of these lives in a pure, tested module rather than inside a component:

| decision | where | how it varies |
| --- | --- | --- |
| Overview slots | `presentation/overview-presentation.ts` | Always headline, problems, ran and scan. Each slot is ready or carries an explicit refusal. |
| What the screen leads with | `presentation/finding-mix.ts` | The count of what was found, split by the bundle's own polarity, broken down by severity, with the most serious one named. Both sides are always built so the control that switches between them knows whether the other side holds anything. |
| A count of a known total | `presentation/fraction.ts` | Done, total, remaining and a share. A total of zero has no share and draws no bar. |
| What kind of system this is | `presentation/system-shape.ts` | The three commonest kinds named, the rest counted, ordered by count then by name so a repository describes itself the same way every build. |
| Depth slots | `presentation/section-presentation.ts` | Every non-Overview screen always carries summary, primary and detail. Empty evidence produces a reason and command in place. |
| The four sets the answer is made of | `presentation/overview-presentation.ts`, `DeltaSets` | Derived rather than read off `coverage`, because `coverage.declaredComponents` counts the parts a trace could record and holds the undeclared ones inside it. Taking the never seen and the never declared out of it leaves `seen`, which makes the three measured sets a partition and makes them agree with the map's filter. |
| Rail cells | `presentation/delta-meter.ts`, `CELL_LIMIT = 120`, `DENSE_ABOVE = 48` | At or below 120 parts one cell is one part. Above it the rail stays at 120 and carries the proportion, and the caption says what one cell stands for. Gaps close above 48. Every cell is the same size as every other cell, and the rail takes the width it is given. Neither a non zero seen count, a non zero never seen count nor a non zero undeclared count can round away to nothing. |
| Whether the rail was measured at all | `presentation/delta-meter.ts`, `buildUnmeasuredMeter` | Prefers `summary.observableComponentCount` when present so the no-run rail names the same set the measured rail will. Older bundles fall back to `componentCount`. |
| Whether a run has ever touched a part | `presentation/component-presence.ts` | Five states, four of them selectable. Two of the five take the dashed mark, because neither can be drawn hollow: a report with no run, and a kind no trace records. The map's filter is absent rather than empty when no run exists, because every part is then in the same state. |
| Where the working set splits | `presentation/finding-groups.ts` | Goal-ready ahead of needs-review, the order `sortFindingsForAction` already produced, drawn as a boundary instead of a phrase at the right hand edge. A group nothing falls into is omitted. |
| What a chaos run adds up to | `presentation/resilience-outcomes.ts` | Counts over booleans the run recorded. An incomplete task and a task that completed after degrading are separate, because only one of them is a failure. |
| Which scenario to work on first | `presentation/scenario-order.ts` | Never run first, then the repository's own order. |
| Which components the map draws | `packages/report/src/layout.ts` | Only components a relation touches get coordinates. In `openai-agents-python` that is 298 of 1390. |
| What the map admits it left out | `map-census.ts` | Per kind, worst first, and nothing at all when the map drew everything. |
| Whether the map names things | `map-names.ts`, `NAMEABLE_CEILING = 120` | Decided from the drawn count and the camera together, because the ceiling is about room: `drawn * ratio <= 120`. At the fitted view a small graph is named in full and a large one draws shape and says which magnification will name it. Zooming in halves the effective count and the names arrive. What you select is named at any size. |
| Presence marks | `ui/presence.tsx` | Five states, and the two that cannot be drawn either way matter most: a report with no run says `no run to compare`, and a prompt says `nothing a run records`, both dashed rather than claiming a run looked and found nothing. |
| Navigation counts | `ui/shell.tsx` | Shown for every counted section, including zero, so the shell does not change shape with the report. |
| Filter options | `filters.ts` and the sections | Only severities, categories, bases and kinds actually present in this bundle appear. |
| Overlays | `overlay.ts` | Only the overlay kinds the bundle carries. A measured value fills, an absent one stays hollow. |
| Actions | `capabilities.ts` | Undeclared capability means no control at all. Declared but unavailable means a disabled control with the server's own reason beside it. |
| Empty and refusal states | the presentation binders and every section | Each named slot stays present and names the reason and command that would produce missing evidence. |

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
appearance: every section reachable, the rail's cells all one size, the rail reaching both edges and
crossing the seam between the two grounds, the headline opening the map with that set selected, Overview
and the map agreeing on the size of the set they both name, the answer and the rail whole in the first
viewport, the working set on the page rather than in a menu, tile menus preserving the page height, the
map's table carrying the same parts as the canvas, filters narrowing both, a finding showing its basis and evidence, an unavailable action
explaining itself, no request to another origin, the shortcut panel by keyboard, the composition not
following the operating system, navigation by landmarks and headings, visible keyboard focus, reduced
motion respected, and no sideways scrolling at 390px. If markup changes force a test change, change it
deliberately and say so. Do not weaken what it asserts.

Measure against the corpus, not the demonstration. `apps/demo` has 33 components and is the small,
dense, unrepresentative case. `corpus/.cache` holds real checkouts; `openai-agents-python` has 1390
components with 226 relations and `langgraphjs` has 709 with 659. Anything that only works at 33 is not
finished.

## Where to continue

Protect the contract before adding another representation. A change that needs report-specific layout
belongs in a pure binder first, with a refusal test, and should still fill the same named slot. Use three
regimes for design attention: no run, run with findings, and goals. `crewai` is the large no-run case;
`demo-populated` is the rich runtime and goal case; the demonstration is useful only as the small case.

The gallery remains a regression lens across all cached reports. The state tables are historical and
must not become an incentive to preserve or expand every incidental branch. Start by looking at the real
pages and verify that Overview still answers gap, concern and handoff in its first viewport.
