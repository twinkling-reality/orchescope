# The report workspace design system

What `apps/web` is built from, and why each rule is the rule. The direction is recorded in
[`report-direction.mock.html`](report-direction.mock.html), which is a static mock of the delta screen
using real numbers from `apps/demo` and is not a file that ships. This document is what was built.

## One idea

**Fill means evidence. A filled shape was measured in a run. A hollow outline was only declared.**

That rule holds on the delta bar, on the map nodes, in the components table and on the severity
marker. It is the visual form of the rule `AGENTS.md` already states, that an inference is never
presented as an observation, and because it is carried by form rather than by hue it survives
greyscale, a colour vision deficiency and a printed page.

There is a fourth state and it is the one that is easiest to report wrongly. A report with no run in
it cannot say that a component was never exercised, only that there was nothing to exercise it. A
hollow shape there would be an inference presented as an observation, so nothing is hollowed: the map
draws every node filled and says why in its own legend, and the components table draws a dashed mark
reading `no run to compare`.

**Hue appears on a severity marker and the word beside it, and on the chrome. Nowhere else, ever.**
Everything that used to be tinted says itself in a word instead: `not satisfied`, `regressed`,
`absent`, `failed`, `skipped`. A state that is genuinely an alert is already a finding carrying a
severity, and severity is where the two alert hues live. The one accent marks what has focus, what is
selected and what is a link, none of which is a measurement. See
[One accent, and it never touches the data](#one-accent-and-it-never-touches-the-data).

## Tokens

Defined once at the top of `apps/web/src/styles.css`.

### Families

Manrope for prose, JetBrains Mono for every number. Both SIL OFL 1.1, both vendored as variable woff2
in `apps/web/src/fonts/` with their licence text and their provenance.

The fallback stacks are chosen so a face that fails to load changes the texture and not the layout:
the system UI face is the closest widely available humanist sans, and `ui-monospace` resolves to SF
Mono on macOS and Cascadia on Windows, both of which have tabular figures, which is what every number
on the page depends on.

### Neutrals

Eight values in three roles. The brief that started this work said six greys; the eighth is the one
the mock's own comment argues for, and the seventh follows from it. `--outline` means "declared but
never measured" and has to be as legible as the fill it contrasts with, so it can never be the
hairline used for layout rules.

| token | value | role |
| --- | --- | --- |
| `--paper` | `#FFFFFF` | the ground of the tile this is declared on |
| `--sheet` | `#FBFCFE` | a surface inside a tile that has to separate from it |
| `--rule` | `#E3E6EC` | the hairline between tiles, and between sections inside one |
| `--rule-soft` | `#EFF1F5` | the hairline inside a group |
| `--outline` | `#AEB5C1` | declared, never measured |
| `--ink` | `#12151C` | text, and every filled shape |
| `--muted` | `#5D6674` | secondary prose |
| `--faint` | `#9AA1AF` | eyebrows, basis words, meta lines |

Those are the values on the field ground, which is the tile most of the report is written on and also
the root's own ground so a sliver of overscroll reads as a tile continuing. Two other grounds redefine
all eight, and the redefinition is the whole technique: see
[A tile owns its ground](#a-tile-owns-its-ground). There is one palette and no theme.

### Alert hues and the accent

`--high` and `--medium`, on a severity marker and its word and nothing else. `--accent`, one blue, on
the chrome and nothing else.

Both alert hues are restated on the other two grounds, which is a change of lightness and never of
hue. `#b42318` on a near black ground is a smudge, and on the band's `#cbd8f7` the field's amber
reaches 3.8:1 against a word set at 10px. They are the same two hues carried onto a different ground,
not four hues.

Two hues cover five severities, so hue alone cannot separate them and is never asked to. The mark
carries the rank as well, and all five forms differ in greyscale: critical draws two filled squares,
high one, medium a filled half height bar, low a hollow square, info a hollow half height bar. More
ink means worse. A severity this build does not rank draws a hollow circle, which belongs to no rank.
`apps/web/test/finding-text.test.ts` holds that all five marks and all five words are distinct.

### Space, radius, measure

`--s1` to `--s7` at 4, 8, 12, 16, 24, 40 and 64. One radius at 2px. One measure at 68ch. One tool rail
at 264px and one bento row at 300px.

There is no `--column` any more. The bento is full bleed at every width, so there is no box for a
column to be the width of, and what governs line length is `--measure` at 68ch, unchanged. A tile's
own inset is `clamp(--s5, 2vw, --s6)`, so a wider window gives a tile more air rather than a longer
line, and the chrome takes the same inset so the wordmark sits over the first tile's own content.

### Type

Weight is a function of size, which is two rules rather than thirteen exceptions:

- **Sans**: 200 only at 24px and above, 300 from 16 to 23, 400 for body, 500 for headings.
- **Mono**: 300 at 16px and above, 400 below.

Thin type below 24px stops reading, and on the black tile it stops sooner. Every number is mono with
`font-variant-numeric: tabular-nums`, including the 56px figure, so a percentage that changes between
two reports does not shift the layout.

## The primitive set

Ten components in `apps/web/src/ui/primitives.tsx`. Every screen is assembled from these plus the
existing controls, and no screen has a style that is not here.

| primitive | what it is for |
| --- | --- |
| `Eyebrow` | names a tile or a group inside one; the only all caps in the system, and never a value |
| `Display` | the sentence a screen leads with, generated from the data by `headline.ts` |
| `Figure` | one large number and the mono qualifier that says what it counted |
| `Data` | every number, anywhere |
| `BasisChip` | `Observed`, `Discovered`, `Inferred`, `Estimated`, `Simulated`; no hue, no marker |
| `SeverityMark` | a square and a word; the two alert hues live here |
| `BarCell` | one cell of the declaration bar |
| `RuledStat` | a supporting number, ruled rather than boxed, always carrying its basis |
| `DisclosureRow` | one line that expands to what is behind it |
| `RefusalPanel` | the empty and refusal state of every screen |

A name that came out of the analysed repository is never set in an eyebrow. `getUserById` rendered as
`GETUSERBYID` changes what a reader thinks the repository wrote, so the eyebrow names the kind of
block, which is this repository's own vocabulary, and the name itself is a heading below it.

### What was removed and what replaced it

`Chip` with four tones, `Callout` with four tones, `BooleanValue` with a tick and a cross and `Bar`
with an accent are gone. In their place is `.meta`, a quiet line of mono words separated by a middle
dot, and the word alone. `Confidence` became `Data`, because it is a number. `EmptyState` became
`RefusalPanel`. `SectionHeading` became `Eyebrow`.

`.block` and its three levels, `.deck` and `.card` are gone as well, and `.tile` replaced all of them.
A level said how much a panel mattered by how heavily it was ruled, which is a distinction the bento
now carries in the place a tile takes and the ground it owns. `.card-head`, `.card-body`, `.card-more`
and `.card-more-body` are `.tile-head`, `.tile-body`, `.tile-more` and `.tile-more-body`, unchanged
otherwise. What is left of `.block` is `.group`, which is a section inside a tile.

## Layout

A top chrome carries what is true of the whole document, in three zones on one row: the mark and the
repository on the left, the eight screens centred on the page, and two icons on the right. Nothing in
it is numbered. The sections have no order to walk in, and a number beside each one implies a sequence
that does not exist and that a reader would then look for.

The left is the temporary mark, a `/`, and the project name, which is the document's `h1`. Two rings
and a centre on a plate of ink: it is the concentric arrangement the map draws, it is the one shape in
this document drawn for its own sake, and it is hidden from assistive technology with the product name
read in its place. It replaced an all caps eyebrow reading `ORCHESCOPE` above the project name, which
spent two lines on a fact that never changes.

The right is two icons of the same size on the same baseline: report details, and keyboard shortcuts.
A `summary` is one of them and a `button` is the other, so the two controls are the same object
whether they open a menu or toggle a panel.

It used to be a rail of 216px down the left. Width is what the reports needed and height is what the
chrome had spare: the rail spent about four hundred pixels of nothing between the navigation and the
theme control it then carried on every report while taking 216 from every screen, and the screens that suffered were
the ones with the widest evidence in them. The chrome is 110px tall and gives all of that width back,
which is what a seven column components table on a repository of 1727 components had never had.

**The navigation is centred on the page, not between its neighbours.** It used to take a row of its
own because three tracks of `auto 1fr auto` centre the middle one between two zones of unequal width,
which put it 128px left of the middle of the page on the demonstration and somewhere else again on
every other report. Two things fixed it. The provenance folded into an icon, so the right zone went
from 331px to 84px; and the outer tracks are `minmax(0, 1fr)` each, which is what makes the middle one
land on the middle of the page whatever either neighbour holds.

Measured, the eight pills are 861px, the mark and the longest project name in the corpus are 269px,
and the two icons are 84px. Equal outer tracks therefore need `861 + 269 * 2`, which is 1399, so below
1400px the navigation drops to a second row and left aligns. The chrome is 57px on one row against the
110px the two row version cost on every screen.

The project name carries `min-width: 0` as well as `overflow-wrap: anywhere`. A flex item's floor is
its content, so without it `pydantic-ai-exercised` pushed the two icons 26px off the right edge of a
390px screen rather than wrapping.

The current section is a filled pill and never a heavier label. In a row a heavier label is a wider
label, so weight would move every other link sideways each time a reader changed section; a pill
changes the ground and leaves the type alone.

The project name is the `h1`, because the document is a report about that repository. A section's
label is a visually hidden `h2`, a tile's eyebrow is an `h3` and a group inside it is an `h4`.

Below 880px the chrome stops being sticky and stacks: a sticky bar on a phone takes a fifth of the
screen and never gives it back. Every grid track is written as `minmax(0, 1fr)` rather than `1fr`: a
bare `1fr` has the widest thing inside it as its floor, and one wide table in the main column pushed
the whole page past the viewport. `tests/ui/workspace.spec.ts` holds that no section scrolls sideways
at 390px.

## One accent, and it never touches the data

`--accent`, one blue, defined once beside the neutrals.

It marks what has focus, what is selected and what is a link: the focus ring, a selected row in the
components table, a checked filter token, the skip link, the report details menu's top edge and the
keyboard shortcut panel's. Every one of those is a fact about the interface.

**Where you are is no longer one of them.** The current section is a filled pill in `--ink`, because a
rule under a word was the quietest marker available on the busiest line of the document and beside
seven other labels it read as an underlined link rather than as a position. The pill keeps the one
property the rule was chosen for: it changes the ground and not the type, so no other label moves
sideways when a reader changes section. **It is never a bar cell, a map node, a presence mark, a severity marker or a number.** Fill
still means evidence and severity still owns the two alert hues, and an accent that reached the data
would let a reader infer a verdict the report does not carry.

Blue rather than green, because green reads as pass and would be taken for one beside `satisfied` and
`not satisfied` acceptance criteria. Blue rather than violet, because violet sits between the two alert
hues and is the hardest of the four to tell from amber in greyscale.

## The bento, and there is no page ground

A screen is a bento, not panels on a background. There is no main background colour anywhere in the
stylesheet: the viewport is filled by tiles that tile it, and every seam between two of them is one
hairline rather than a gutter of page showing through.

Before this the page had a visible ground with rectangles floating on it, separated by 16px of paper
between cards and 40px around the outside. That is a composition made of the gaps, and on the screen
thirteen of the sixteen cached reports open on it was mostly gaps: the delta refusal band, then four
equal cards of which three were half empty.

### The grid

Twelve columns, `gap: 0`, and the hairline is drawn by each tile on its right and bottom edges only,
so two neighbours share one line rather than drawing two. The last tile in a row draws against the
viewport edge, which is why the seam count does not depend on what a screen holds.

Tiles are unequal, because a bento is not a uniform grid. There are four places and they compose one
row:

| place | width | what it is |
| --- | --- | --- |
| `.tile` | 12 of 12 | the band a screen leads with, or an evidence table under the row |
| `.tile.is-anchor` | 4 of 12, two rows | the thing on the screen with the most consequence, and the dark ground |
| `.tile.is-stage` | 5 of 12, two rows | what measures it |
| `.tile-stack` | 3 of 12, two rows | a holder for one, two or three short tiles |

The stack is a holder rather than a tile: its children own the ground and draw the hairlines, and
however many there are they share the height of the anchor beside them. A fixed second row would leave
a hole on a screen with one short tile instead of two.

The place and the ground are coupled on the anchor and nowhere else. That is the composition rule: a
black tile does not appear in the middle of a row. `.tile.is-dark` exists separately for the map,
where the drawing is the dark ground and spans the whole working column.

Below 1180px the anchor and the stage take six each and the stack takes the next row, because three
tiles across give each of them under 400px, which is less than the narrowest thing any of them holds.
Below 880px it is one tile to a row. Neither breakpoint restores a gutter.

### A tile owns its ground

**A tile gets its ground by swapping the neutrals inside itself rather than by restating any rule that
uses them.** Everything in the stylesheet already draws from `--ink`, `--outline`, `--sheet` and the
two alert hues, so a local redefinition carries the whole system across intact: a filled bar cell is
still that tile's ink, a hollow one is still its outline, and fill still means evidence on the other
ground. The canvas comes too, because `readPalette` in `ui/graph-canvas.tsx` reads the same four
properties off its own element, so the map inverts without the renderer knowing.

That is the technique the feature panel already used. What is new is that it is now the only way a
ground is set anywhere, and that there are three of them rather than one panel on a page.

| ground | value | what it carries |
| --- | --- | --- |
| band | `#CBD8F7` | the screen's own statement, or its refusal. Light, and across the top |
| anchor | `#0B0D12` | the tile a row is built around. Black, and in the corner |
| field | `#FFFFFF` | everything else |

The anchor is 19.43:1 against the field and the band is 1.43:1, and those are the only two numbers
because there is only one palette.

`--wash` is gone. The band is the accent as a ground, and it is the only place the accent is a surface.
Nothing drawn on it means anything by being on it, so fill still means evidence and severity still owns
the two alert hues.

### There is no theme, and the arithmetic is why

A themed palette has to hold the three grounds apart in the dark one as well, and it cannot. Measured
on the palette this replaced:

| | light | dark |
| --- | --- | --- |
| page against lifted surface | 17.81:1 | **1.19:1** |
| page against accent wash | 1.15:1 | **1.11:1** |
| wash against lifted surface | 15.45:1 | **1.07:1** |

On a dark machine the page, the feature surface and the wash all landed inside 1.19:1 of each other
and read as one grey rectangle, and there was nothing on screen to tell a reader another reading
existed. That is not a palette that was picked badly. To reach even 3:1 against a near black anchor
the lighter ground has to arrive at about `#5C626E`, which is a mid grey and not a dark theme at all,
so no set of dark values recovers the light composition.

A version of this was tried that fixed only the anchor and let the field and the band follow the
theme, on the argument that a control which changed nothing would be a button that fails when
pressed. It was rejected on sight: the dark result still read as one navy rectangle, because two
grounds inside 1.13:1 of each other is the same failure with one fewer participant.

So all three grounds are fixed by role. Once a tile owns its ground there is no page background left
for a theme to act on, so the control is gone rather than left doing nothing, which is the same rule
this repository applies everywhere else: absent, or disabled with its reason shown.

`tests/ui/workspace.spec.ts` holds it from both sides. One test asserts the order of the three grounds
and that the anchor is black and the field is paper; another emulates `prefers-color-scheme: dark`,
reloads, and asserts that all three ground colours are unchanged and that nothing offers a palette
control.

## Detail behind a `···`, and the evidence screens that refuse it

Each tile summarises and puts its detail behind a `···`, which is a `details` element for the same
reasons the disclosure row is one: it works before the script runs, it is in the tab order without a
`tabindex`, it announces its own expanded state, and the browser's own in page search finds what is
inside it while it is closed. Opening a tile grows that tile and nothing else, which is what tells a
reader which one they opened.

**The evidence screens are not bento and are not meant to be.** A components table of 1727 rows and a
findings list carrying every source location are the document this report exists to be. Putting them
behind a `···` would hide the evidence a finding is required to carry, and the table in particular is
the canvas's only keyboard reachable form. What the bento gave them is the frame rather than the
disclosure: the 264px filter rail is a tile, the canvas is the dark tile, and the table and the
details are field tiles, all hairline separated and edge to edge with no ground under any of them.
The same holds for the per component measurements table, the metric deltas table and the runs table,
which sit under their screen's bento row as full width tiles with nothing folded away.

**A band holds a statement and never an unbounded list.** A surface that is the whole page is not a
band of anything, which is what wrapping nineteen expandable findings in the old feature panel made
it. So Findings leads with the counts by polarity and severity rather than with the list, and the
map's canvas is a tile with the table beside it rather than inside it.

**Every screen's refusal state is the band**, because when there is nothing to show the refusal is the
statement, and thirteen of the sixteen cached reports have no run in them and open on exactly that.
The refusal is two columns pushed to the two ends of the band, what is missing at the start and the
commands that produce it at the end, because a command is forty characters and a paragraph is sixty
eight and stacking them made the shorter thing the wider one.

On Performance the commands are named once, on the band, rather than once on each of the three tiles
that would otherwise repeat `orchescope trace`. Four copies of one command is a screen that reads as
four faults instead of one absence. A tile whose command differs, which is Benchmarks, names its own.

## Width is a bento, not a wider paragraph

The bento is full bleed at every width and prose is capped at 68ch whatever the window does. Those two
facts together are the whole layout problem: a single column stack on a 2000px screen puts every
block's content in a 600px ribbon on the left and leaves the rest of the line empty. Measured on
`crewai` before any of this, the page had 264px gutters, prose at 518px, and a 1070px box holding a
fifty character command. That emptiness is inside the block rather than outside it, which is the one
kind a reader takes for a fault.

Three rules keep it out of a tile:

- **A stat row wraps at 240px rather than 150.** Four ruled numbers in a tile five of twelve wide fitted
  at 155px each and then had nothing under them. At 240 the same four wrap to two by two in a tile and
  stay on one line across a band. The rule sits above a stat rather than beside it, because a rule to
  the left is a rule the first item of a wrapped row would draw as well, and a grid cannot be asked
  which of its children start a line.
- **A definition list stops at the measure.** Its value column is prose, and without the cap a full
  width band set `deterministic and offline` across 1240 pixels.
- **A band whose statement is prose gets `.lead-head.is-prose`**, which is the same two columns with
  the left one at the measure instead of at 26ch. Goals, Resilience and Scenarios lead with a
  paragraph rather than with a display sentence, and stopping the paragraph at 68ch without putting
  anything beside it left 1000px of band empty.

**The tile that takes up the slack is the provenance footer.** On a report shorter than the window
something has to reach the bottom, and it should not be the screen's own tiles: a refusal band
stretched to 600px reads as unfinished, where the same band at its own height above a field tile reads
as a band. There is no page ground for the difference to fall through to, so the footer, which is a
field tile, grows.

## The delta bar at real scale

`apps/web/src/delta-bar.ts`, with `apps/web/test/delta-bar.test.ts` beside it.

The demonstration declares 22 components and one cell is one component. `openai-agents-python`
declares 917, where one cell per component is neither readable nor something to put in a document. So
the bar has a ceiling of 120 cells. Below it a cell is a component. Above it the filled share is the
measured rate rounded onto 120 cells, and the caption says which of the two a reader is looking at
rather than leaving them the flattering reading.

A count that is not zero never rounds away to nothing. A single component that ran and was never
declared is the whole reason the dashed boundary is drawn, and a bar that hid it because 1 of 917
rounds to zero would be reporting the absence of the thing the delta exists to find.

The whole bar is one `role="img"` with an accessible name carrying the real counts, never the rounded
ones, so up to two hundred and forty elements never reach the accessibility tree.

The bar and its caption share one box that is as wide as the cells and no wider. A cell is a fixed 24px
until there are enough of them to need the whole width, so on a report declaring twenty two components
the bar stops well short of the column, and a caption stretched to the column printed the word
`Outside` a third of the page away from the cell it names. The width of a cell is stated as well as
flexed: a flex basis is not an intrinsic contribution, so a cell with no content in it measures zero
when the box asks the bar how wide it wants to be, and the whole bar collapses to its own minimum.

## The join summary

`ReconciliationDelta.joins` was computed by the pipeline and read by nothing. Every join is made by a
rule and the rules are not equally strong: a match on a code location is the observation and the
declaration pointing at the same line, and a match on kind and name alone is correct whenever a name
means one thing in a repository and wrong when two modules use the same word, which has already
happened here. The bar is only as good as its weakest join, so the count and the components joined
that way are named beside it rather than buried in a disclosure.

## The fonts, and the standalone export

The served report runs under `font-src 'self'` and gets the two faces as real files from its own
origin, added to the closed list in `packages/report-server/src/server.ts` and read as bytes: a font
decoded as UTF-8 and re-encoded is a request that succeeds, a length that is plausible, and a face the
browser refuses without saying why.

The single file export gets `font-src data:` and the faces inlined. Opened from a disk it is a `file:`
page, where `'self'` resolves to nothing it can fetch, so a self hosted face is unreachable and the
export would fall back to whatever the reader's machine has. The design carries meaning in the type,
so that is a different document rather than a plainer one, and this file is the artifact most likely
to be read by someone who never ran the tool. The widening cannot be abused: `default-src 'none'`
still blocks every network destination, the only `data:` scheme allowed is the font one, and a font is
not executable. `packages/report/test/standalone.test.ts` holds both halves.

One stylesheet is built twice from the same source, `file` loader for the served build and `dataurl`
for the standalone, so the `@font-face` rules, the weight axes and the unicode ranges have one
definition.

The Open Font License requires its notice to travel with the software wherever it is redistributed.
The served report ships both licence files beside the faces, and `scripts/package.mjs` requires them
in the tarball for the same reason it requires `index.html`. The single file export has nowhere to put
a file, so the same notice is a legal comment at the top of the stylesheet, which esbuild's minifier
keeps and which therefore travels inside the one document.

## The map

The canvas is the dark tile and the components table is a tile of its own below it. They are
not set side by side: the table carries eight columns and the canvas is square, so a split would give
each of them less than either needs, and the table is the representation this report treats as primary.
The filters are a tool rail to the left of both.

The canvas was rebuilt after a reader called it unreadable. It was, and the cause was not the renderer.

### The layout was the wrong algorithm for the data

Every agent system in the pinned corpus is hub and spoke. The median degree of a connected component is
one or two, and the busiest component has a degree of 18 in the demonstration, 24 in
`openai-agents-python` and 98 in `langgraphjs`. A layered layout puts every leaf of a hub in a single
rank, so the drawing grows in one direction and not the other:

| repository | connected | layered | concentric |
| --- | --- | --- | --- |
| demonstration | 26 | 1152 x 1783 | 795 x 798 |
| openai-agents-python | 298 | 848 x 19050 | 2997 x 3000 |
| langgraphjs | 329 | 1456 x 20066 | 3199 x 3200 |

A ribbon of aspect 0.045 rendered into a canvas of aspect 2.3 is what a reader saw as a column of dots.
`@dagrejs/dagre` is gone and with it a dependency; the ring layout is about eighty lines in
`packages/report/src/layout.ts` and needs no library. Coordinates are still computed once, in the process
that builds the report, so the same graph produces the same map on every machine.

A layered arrangement came back later and it is not this one. What made the ribbon was one rank per line;
what removed it was wrapping an oversized rank into a block. The ring is still the arrangement a reader
starts on, and it is still the only one that holds up on the densest drawing in the corpus. See
[One graph, three arrangements](#one-graph-three-arrangements) for what was measured and what it decided.

### It drew things that are not in the graph

A component no relation touches is not part of any topology. In `openai-agents-python` that is 1091 of
1390, including 368 of its 370 prompts and 479 of its 620 agents. They were drawn as anonymous circles,
they inflated the drawing 6.5 times, and they made a field of unconnected dots look like a system.

They are not drawn now, and because that is a large omission it is stated rather than implied.
`apps/web/src/map-census.ts` reports it per kind, so a reader sees `Prompt 2 of 370` rather than a
number with no shape to it. A view that quietly showed 22% of a repository would mislead more than one
that drew the other 78% badly.

### The room for a name is read off the drawing, not derived from its shape

This used to be a constant. The outermost ring of a drawing fitted into a canvas of height H has a radius
of at most H/2, so two neighbours on it have about `2200 / k` pixels between them, a name needs roughly
16 of those, and 2200 / 16 is 137, rounded down to 120. Below 120 drawn components every name was drawn
and forced past Sigma's collision grid; above it the canvas drew the shape and said so.

That is a good derivation of the wrong quantity, and it was wrong twice.

It is about a circle. The map now offers a directional arrangement as well, where the relationship
between the node count and the room between neighbours is nothing like a circumference, so a rule
derived from one has nothing to say about the other.

And it was not true of the circle either. Sixteen pixels is what two names need where they are stacked
one above the other, which is what happens at the left and right of a ring. At the top and the bottom of
a ring two neighbours are side by side, and there a name needs its own width. Over the 2994 positioned
components in the pinned corpus a name averages 22.7 characters, which is 159px of 11px mono, and the
ninetieth percentile is 56 characters. So the ceiling promised that every one of 120 components would be
named while a drawing of 26 was already printing two names on top of each other: `demo-populated` put
`search_policies` under `metering_record_usage`, at the fitted view, in the shipped build.

So the room is not computed from a count and a shape. It is computed from the drawing. Two names collide
while they are closer than a line of type across the drawing and their own widths still meet along it,
and a name a node is drawn through is not a name either, because labels are drawn over the nodes and in
the black tile the hole is the same near white the name is set in. The scale at which the last colliding
pair comes apart is a property of the coordinates and the names, whatever produced them, which makes it
one rule for every arrangement and for any arrangement added later.

Two scales come out of it and the canvas says which of the three readings it is giving.

| | when | what the canvas does |
| --- | --- | --- |
| every name | `scale >= nameEvery` | every drawn component is named, and no label may be dropped |
| some names | `nameSome <= scale < nameEvery` | the busiest keep their names, the rest are left out, and the note says how many of how many |
| no names | `scale < nameSome` | the shape of the system, and the magnification that would name it |

The middle reading is the one that used to be silent and wrong. Sigma has a collision grid for exactly
this, and it is a grid: it reserves a cell the width of a name and drops everything else that falls in
one, which left out six names on the demonstration where one had to go. The same computation that finds
the two scales also decides which names survive, walking them busiest first, so a reader loses the fewest
and never loses the hub. `apps/web/src/map-names.ts` holds all of it, with twenty two cases in
`apps/web/test/map-names.test.ts`.

**The scale is the camera's, and it is asked for rather than modelled.** A rule about room cannot be
answered by a count, because the same drawing has more room the closer a reader gets. The old rule tried
to fold the camera in as a multiplier; this one takes the live scale from the renderer's own
`graphToViewport`, so it follows the camera, the window and the narrow breakpoint without a model of any
of them. That matters: a reader who zoomed into crewai's 150 components until each had half the canvas to
itself once still saw no names anywhere, which is a fault rather than a limit.

### One graph, three arrangements

A ring shows what hangs off what and says nothing about which way anything flows. `packages/report/src/layered-layout.ts`
adds two arrangements that say the second thing and give up the first: a top down flow and a left to
right one. All three are computed in the process that writes the report and baked into the bundle, so
determinism is untouched and the browser switches between sets of coordinates rather than running an
algorithm it is not allowed to have.

The layered layout this repository removed put every member of a rank on one line, and every agent system
in the corpus is hub and spoke, so one hop from a degree 98 hub was a line of 98 nodes. Wrapping an
oversized rank into a block removes that completely, and staggering alternate lines by a quarter of the
pitch is what lets the names survive it:

| | drawn | one rank per line | wrapped and staggered | concentric |
| --- | --- | --- | --- | --- |
| demonstration-system | 25 | 3250 x 600 | 910 x 1040 | 795 x 798 |
| crewai | 150 | 16120 x 400 | 1690 x 1788 | 2198 x 2000 |
| openai-agents-python | 298 | 18590 x 400 | 2340 x 2438 | 2997 x 3000 |
| pydantic-ai | 678 | 67600 x 400 | 3510 x 3608 | 4599 x 4599 |

Every corpus graph lands within five per cent of square, and rank r is still entirely ahead of rank r+1,
so the flow still reads. The stagger is most of the difference between naming a drawing and not: measured
over connected slices of every corpus repository, a flat lattice places 58 per cent of the names of a
drawing of 25 nodes and the same lattice staggered places all of them.

Which arrangement is for which report is a measurement rather than a preference. Names placed clear at
the fitted view, on a desktop canvas:

| report | drawn | concentric | top down | left to right |
| --- | --- | --- | --- | --- |
| flask, express, axios, anthropic-quickstarts | 4 to 17 | all | all | all |
| demonstration-system | 25 | 24 | **25** | **25** |
| demo-populated | 26 | 25 | **26** | **26** |
| vercel-ai-chatbot | 35 | 30 | **35** | **35** |
| crewai | 150 | **77** | 17 | 21 |
| langgraph | 288 | 40 | 35 | **53** |
| langgraphjs | 329 | 30 | 30 | **41** |
| pydantic-ai | 678 | 14 | 25 | **39** |

Under about 17 drawn components there is nothing to choose between them. From 25 to 35 the directional
arrangements name everything and the ring does not, which is `demonstration-system`, `demo-populated` and
both `vercel-ai-chatbot` reports. Between 288 and 417 the ring names nothing at all and a directional
arrangement is the only way to get a name on the drawing: `langgraph`, `openai-agents-python`,
`langgraphjs` and `openai-agents-js` are four reports the picker exists for. `crewai` is the one report
where the ring is far ahead, at 77 against 21: its hub has a hundred leaves, and a ring spreads them over
an annulus where a lattice packs them into rows. At 679 drawn nothing names anything and all three say
so.

At the narrow breakpoint the ordering reverses between 17 and 35, where the ring keeps 13 to 17 names and
the directional arrangements keep 6 to 14, so the ring stays the default. Nothing names much of anything
on a phone past 40 drawn components.

The picker is a select beside the overlay, built from the same primitives, and it is absent rather than
disabled on a bundle that carries one arrangement, because that bundle is not refusing anything: it was
written before the others existed. Two extra arrangements cost 90 bytes for each component they position,
which is 63 KB on `pydantic-ai`'s 4.9 MB and between 0.5 and 2.2 per cent everywhere.

**What the canvas can say, the table says too.** The coordinate a directional arrangement draws is the
depth: how many relations from an entry point a component sits. The components table carries it as a
column for the same reason it carries relations, because the canvas is hidden from assistive technology
and a fact that is only a picture is unreachable by keyboard. It is empty on a group row, which
aggregates depths that differ, and reads `not drawn` for a component with no place in the flow.

### What is answerable without the picture

The canvas is hidden from assistive technology, so anything only it could say would be unreachable by
keyboard. The components table carries a relations column for that reason: the map puts the busiest
component at its centre, and without the column "which thing does everything hang off" would be
answerable only by looking. A nought in that column is also how a reader finds the components the map
left out.

It carries a depth column for the same reason. What the directional arrangements add over the ring is
the order of the flow, and the order of the flow is a number: how many relations from an entry point a
component sits. A reader who cannot see the drawing can sort on it, and the answer is the same one the
picture gives.

## Every screen has an empty state and a refusal state

| screen | when it has nothing |
| --- | --- |
| Overview | no run: what the delta is and the three commands that produce one. Nothing declared: `init --manifest` |
| System map | no components: what was looked for, and the manifest. Canvas failed: the reason, and that the table beside it is primary |
| Findings | no findings: what that says about the rules rather than about the system. Filters match nothing: a control that clears them |
| Performance | no metrics, no runs, no benchmarks, an overlay with no values: each says which half is missing |
| Resilience | no chaos run: what fault injection measures. Faults requested and not applied: the table, kept visible |
| Scenarios | none defined, and a scenario defined but never run, which are different states |
| Comparisons | none made, and a verdict of insufficient evidence with its sample sizes |
| Goals | none created, naming the first eligible finding. A goal never validated says undecided rather than unproven |
