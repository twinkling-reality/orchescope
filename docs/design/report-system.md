# The report workspace design system

What `apps/web` is built from, and why each rule is the rule. The direction is recorded in
[`report-direction.mock.html`](report-direction.mock.html), which is a static mock of the delta screen
using real numbers from `apps/demo` and is not a file that ships. This document is what was built.

## One idea

**Fill means evidence. A filled shape was measured in a run. A hollow outline was only declared.**

That rule holds on the rail, on the map nodes, in the table of parts and on the severity marker. It is
the visual form of the rule `AGENTS.md` already states, that an inference is never presented as an
observation, and because it is carried by form rather than by hue it survives greyscale, a colour
vision deficiency and a printed page.

**Two states cannot be drawn either way, and both take the dashed mark.** A hollow shape says a run
looked and did not find this, and neither of them can say that.

The first is a report with no run in it, which cannot say a part was never reached, only that nothing
has looked. Thirteen of the sixteen cached reports are in it.

The second is a part of a kind no trace records: a prompt, a provider, an entry point, the project
itself. A run records agents, models, tools, stores, queues and the effects they cause, and never a
prompt, so no run can say whether one was used. The reconciliation already excludes those from its
denominator; the map's own filter used to label them `Never exercised`, which is why the map reported
eighteen never exercised on a report whose Overview reported seven. They read `Nothing a run records`
now, and `component-presence.ts` gives the weaker answer on a report that never computed the join at
all, because there is nothing there to tell the two apart with.

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

`Share` is the tenth and it earns the place because the Overview alone carries three of them: how many
problems are ready to hand off, how much of the system a run reached, how much of what the scan opened
it could read. Each is a whole of a counted total, which is the one shape that can be drawn honestly
here, and a total of zero draws no bar at all: nought of nought has no share, and an empty track there
would say a thing was measured and found wanting.

| primitive | what it is for |
| --- | --- |
| `Eyebrow` | names a tile or a group inside one; the only all caps in the system, and never a value |
| `Figure` | one large number and the mono qualifier that says what it counted |
| `Data` | every number, anywhere |
| `BasisChip` | `Observed`, `Discovered`, `Inferred`, `Estimated`, `Simulated`; no hue, no marker |
| `SeverityMark` | a square and a word; the two alert hues live here |
| `Meter` | the rail, in `ui/meter.tsx` with the module that builds it |
| `Share` | a count of a known total: how far along, out of how many, and what is left |
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
Both use `ui/chrome-menu.tsx`: the same button, anchored dialog, close action, focus behavior and
responsive position. Opening one closes the other. Neither replaces the report content with a panel.

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
label is a visually hidden `h2`, a tile heading is an `h3` and a group inside it is an `h4`. Depth
screens use an eyebrow when the heading names a protocol block. Overview uses plain headings that name
the reader's decision directly.

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

### The fixed presentation contract

The tiles sit inside slots whose names and order do not vary with the bundle. `ui/section-skeleton.tsx`
owns the two structural contracts:

- Overview is `headline`, `top-actions`, `next-commands`, `context`, `join`, in that order. The
  headline is what this report found, split into problems and things done well, and it takes the full
  twelve columns. Top actions ranks the problems that carry evidence, with the ones ready to hand off
  first. Next commands is the visible handoff. Context says what the scan could read. Under the headline
  those three take five, four and three columns, and the join is a full width tile below them.

  **The headline used to be the join, and moving it is the largest decision on this screen.** `7 of 21
  never ran` is a fact about the quality of our own measurement rather than a fact about the reader's
  system, and no wording made it worth reading before the problems the report had found. What leads now
  is a count of problems, which is about them, has a breakdown worth drawing and has a most serious
  member worth naming. The join has not been demoted in the product: it is a full width tile under the
  working set, still pinned to a revision, and every runtime claim on every other screen still rests on
  it.
  Above 1180px the second row stretches to whatever height the first leaves, so a wide viewport is
  filled by tiles rather than by page under them; narrower screens return to normal document flow.
- Every depth screen is `summary`, `primary`, `detail`, in that order. The primary evidence can be a
  list, table or workbench, but the slot does not disappear when the evidence is absent.

`overview-presentation.ts` and `section-presentation.ts` bind a `ReportBundle` to those slots. They are
pure decision modules, and they select and order facts already in the bundle rather than analysing the
system again. An unavailable slot carries a `PresentationRefusal` with a title, reason and the commands
that would produce the evidence. That refusal is rendered in the slot, so an empty report and a rich
report have the same outer tree.

Section entry files compose the contract and do not own its decisions. A section that needs more than
one concept gets a directory named for the section: Overview separates delta, action ranking, handoff
and context; Performance separates summary, measured evidence and benchmarks; Goals separates the
section frame from a goal contract card. This keeps presentation branching out of large render files
and gives every new pure decision a direct test, including its refusal path.

Section-specific styling follows the same boundary. `styles/overview-layout.css` owns the fixed frame,
`styles/delta-meter.css` owns the rail, `styles/section-lead.css` owns the anatomy every depth screen
opens with, and `styles/overview-actions.css` owns the lower decisions.
`styles/tile-menu.css` owns tile-local overlays, and `styles/chrome-menu.css` owns the shared anchored
chrome menu. `styles.css` is only the ordered import manifest. Foundations, primitives, layout, chrome,
workspace, controls, tables, findings, map, composite blocks and responsive rules each live in a named
file under `styles/`. No section component has to append exceptions to a general-purpose stylesheet.

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
| band, deepened | `#A9BDEE` | the lower half of the Overview hero, and nowhere else |
| anchor | `#0B0D12` | the tile a row is built around. Black, and in the corner |
| field | `#FFFFFF` | everything else |

The anchor is 19.43:1 against the field and the band is 1.43:1, and those are the only two numbers
because there is only one palette.

**The band has a second tone and no other ground does.** It exists for one composition: the Overview
hero is two stacked grounds with the rail crossing the seam, and the lower one has to be deeper than
the upper or the picture reads as the colour running out rather than as depth. The field was tried
there first and was wrong twice over, because white is what every tile below the hero already is, so
the hero's lower half read as a gap between two unrelated regions rather than as the second half of
one. `#A9BDEE` is not a new colour: it is already the band's own hairline, used here as a surface,
which is the same move the band itself makes with the accent. It is 1.31:1 against the band, a tone
step and never a second hue, and the quietest line on the hero reads better on it than on the band
above, 4.0:1 against 3.4:1. It carries `is-band` as well as `is-band-deep`, so every rule that asks
which ground a tile owns gets the same answer.

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

Each tile puts its **protocol depth** behind a `···`, and nothing else: the answer, the working set and
the evidence behind one row of it are all on the page. It is a `details` element for the same
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

**Every missing evidence region refuses in its own fixed slot.** The summary band still states the
screen-level absence, while primary and detail keep their places and either render an empty frame or a
more specific refusal. Each refusal names the reason and a command that can produce the missing
evidence. Repetition is avoided within a tile, but a slot does not disappear merely because another
slot names the same absent run.

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

**There is no filler tile.** Report identity, scan and revision live in the report-details menu. A
second provenance paragraph repeated those facts, added a meaningless scroll target and made short
screens look longer than their evidence. A short report now stops when its fixed slots stop.

## Four ranks, and what each is allowed to hide

Every screen carries the same four ranks, and one line keeps them apart: **a `···` may hold protocol
depth and nothing else.**

| rank | what it is | where it lives |
| --- | --- | --- |
| answer | one figure or one sentence stating what this screen concluded | top of the lead tile, largest type on the screen |
| working set | the three to eight things a reader will inspect or act on | immediately under the answer, always on the page |
| evidence | what backs one row of the working set | expands in place, inside that row |
| protocol | complete tables, vocabulary, join method, capability matrix | a full width region, or a tile menu |

The composition this replaced had two ranks rather than four. A tile showed one line and put everything
else behind the same `···` that held the evidence vocabulary, its own working set included: `Fix this
first` showed one of three ranked risks and the other two were in the menu. So the tile bodies were
mostly empty and the thing to act on was invisible, which is a choice between a headline and a modal
rather than disclosure.

A depth screen opens on the same three parts every time, in `styles/section-lead.css`: the question the
screen answers, the answer, and the one measure or legend that belongs beside it. The visible all caps
repeat of the tab name is gone from all seven. It sat ten pixels tall, forty pixels under the same word
highlighted in the navigation, and the screen's own hidden `h2` already names it for assistive
technology, so it was a repeat for sighted readers and a third mention for everyone else.

## The Overview headline

`apps/web/src/finding-mix.ts`, with `apps/web/test/finding-mix.test.ts` beside it, drawn by
`sections/overview/headline.tsx`.

The anatomy is the reference's own: a control group on the left, a named number in the middle, a
supporting line on the right, and a full bleed picture under all three crossing into the ground below.

**The control is real and it changes the hero.** Good news and bad news are the bundle's own
`polarity`, so pressing it swaps the count, the breakdown, the bar and the one named underneath. A side
with nothing in it is disabled and carries its reason, which is the rule every other control here
follows. This is the choice an earlier pass said the screen did not have; it was there in the schema
the whole time.

**The bar carries the rank in ink, not in hue.** One segment per severity, worst first, each as wide as
its share. High is a solid block, medium is solid and half height, low is an outline, info is an outline
and half height, and a severity this build does not rank is a dashed outline. More ink means worse,
which is what the severity marker already does, so the bar and the mark under it say the same thing
twice rather than asking a reader to learn a second vocabulary. A bar tinted by severity would make the
bar the signal, and this one has to survive greyscale like everything else here.

A severity nothing falls into is left out rather than drawn at zero width, and a severity this build
does not rank is still counted, under its own name, at the end. The slices always add up to the number
above them: a picture that quietly disagrees with its own caption is worse than no picture.

## The join

`apps/web/src/delta-meter.ts`, with `apps/web/test/delta-meter.test.ts` beside it, drawn by
`ui/meter.tsx` and `sections/overview/join.tsx`.

It is a full width tile under the working set rather than the top of the screen. Composed by
`sections/overview/join.tsx` and laid out by `styles/delta-meter.css`.

One rail. Filled where a run reached a part, outlined where it was only written down, and past a dashed
boundary the parts that ran and are written down nowhere. The demonstration writes down 21 parts a run
can reach and one cell is one part. `pydantic-ai` writes down 952, where one cell per part is neither
readable nor something to put in a document, so the rail has a ceiling of 120 cells and the caption says
which of the two readings a reader is looking at rather than leaving them the flattering one.

### The gap leads, not the reach

The screen used to open with what ran. On `pydantic-ai-exercised` that is `3`, which is true and
backwards: what that report found is that 950 of 952 parts have never been seen running. Leading with
the reach is the flattering read of the same measurement, so the figure is the gap and the reach is one
of the sets beside it.

### Every cell is the same size as every other cell

That is the invariant, and it is the one thing about the rail that may never move: no unit of meaning
draws with more ink than another unit of the same meaning.

Two compositions broke it in turn. The first sized its cells from the height the viewport left over, so
on `pydantic-ai-exercised` at 1920 by 1080 a cell standing for one part measured 24 by 312 pixels in one
group and 24 by 38 in another, 8.2 times the ink for the same meaning on the same screen. The second
fixed a cell at 34px, which held the invariant and broke the composition instead: measured on
`demo-populated` at 1728 wide the rail was 891px of a 1728px band, 802px of the widest element on the
page were empty, and the inked fraction fell from 69 per cent at 1280 to 46 at 1920. A wider window
emptied the picture along the other axis.

**So the rail takes the width it is given and divides it evenly.** It bleeds to both edges at every
width, and it stops there: no whole cell is ever cut, because the cells are countable units and a sliced
cell is a count a reader cannot take. `tests/ui/workspace.spec.ts` holds both halves, that every cell is
one size and that the rail reaches both edges.

### It is a rail and not a row of boxes

The height is what decides which. At 68px a cell on a report of 21 parts measured about 80 by 68 with a
2px radius and 3px of air around it, which is a near square card, and twenty one of them read as a row
of objects rather than as one measurement divided up. The same cells at 34px are wide flat segments and
the row reads as a meter again. The corners are square and the gaps are hairlines for the same reason:
a radius and a wide gap are what make a division look like a thing.

### It crosses the seam between two grounds

The hero is two tiles, the band and the band deepened, and the rail hangs half its height below the
upper one so the ground changes underneath it. The rail is a child of the band, so it keeps the band's `--ink` and
`--outline` the whole way down and does not change appearance halfway: only what is behind it changes.

Nothing is meant by which half of the rail sits on which ground. That is exactly why it is allowed: the
join has no magnitude, no sequence and no trend, so a composition that added depth without adding a
reading is the only kind this screen can carry.

A cell that was never measured draws its own ground rather than letting what is behind it show through.
Everywhere else that is the same pixel; on the rail it is the difference between one mark and a mark
that is lavender in its top half and white in its bottom half.

### Three rounding rules, and each exists because breaking it reports something untrue

A non zero seen count never rounds away to nothing: two parts of 952 is a quarter of a cell, and the bar
this replaced drew none of it while its own accessible name said two were reached.
`docs/design/states/overview.md` recorded that as the most striking state on the screen and nothing had
fixed it. A non zero never seen count never rounds away either, which is the mirror of the same rule.
A non zero undeclared count never rounds away, because a single part that ran and is written down
nowhere is the whole reason the boundary is drawn.

The cell count is `min(declared, 120)` rather than `round(declared / componentsPerCell)`. The second
form halved the rail between 120 and 121 parts, which was the sharpest discontinuity on the screen and
meant nothing about the repository.

### The four sets flank the answer, and they are what it is made of

Each opens System map with that set already selected, because a number a reader cannot open is one they
have to take on trust. The headline is a control too: it opens the gap it names.

They do not redraw the hero, and nothing pretends they do. The reference this composition came from
flanks its hero with controls that change what the chart is, weekly against monthly and this week
against last. There is no such choice here: one join, over every run in the report, at one revision. A
mode switch would change the picture without changing what is known, so what flanks the answer is what
the answer is made of, and what the reference's controls do for a reader, saying what the number is of,
is done by the sets and by the revision line under the rail.

### The sets are derived, and the derivation is a correction

`coverage.declaredComponents` is not the count of parts a repository declares. It is the count of parts
a trace could record, and a part that ran without being declared anywhere is inside it. So the screen
before this counted the same part three times, in the denominator, in the numerator and again past the
dashed boundary, and it overstated in the flattering direction:

| report | said | true |
| --- | --- | --- |
| `demo-populated` | 15 of 22 reached | 14 of 21 declared reached, +1 undeclared |
| `pydantic-ai-exercised` | 3 of 953 | 2 of 952, +1 undeclared |
| `vercel-ai-chatbot-exercised` | 3 of 19 | **1** of 17, +2 undeclared |

`overview-presentation.ts` takes the never seen and the never declared out of
`coverage.declaredComponents` and calls what is left `seen`, which makes the three measured sets a
partition and makes them agree with the map's own filter. Verified against every exercised bundle in
the corpus.

### A report with no run draws the rail too

Thirteen of the sixteen cached reports have none. The written down side of the join is fully known
without a run, so the rail is drawn at its real length in the `no run to compare` state, dashed, and
only the comparison refuses. Nothing there is hollow: a hollow cell would say a run looked and did not
find it, and what is true is that nothing has looked.

That rail counts a wider set than the measured one, because the kind classification lives in the
analysis packages and this workspace may import types and nothing else. `crewai` writes down 987 parts
and 273 of them are kinds a trace records, so the caption states which reading it is and that the rail
narrows once a run arrives. [TODO.md](TODO.md) records what would make the two consistent.

The whole rail is one `role="img"` with an accessible name carrying the real counts, never the rounded
ones, so up to two hundred and forty elements never reach the accessibility tree. Its boundary labels
are rendered by the screen rather than by the rail, below the seam and at the page's own inset, because
anything inside the rail's own box would decide where the seam falls.

## The join summary

`ReconciliationDelta.joins` was computed by the pipeline and read by nothing. Every join is made by a
rule and the rules are not equally strong: a match on a code location is the observation and the
declaration pointing at the same line, and a match on kind and name alone is correct whenever a name
means one thing in a repository and wrong when two modules use the same word, which has already
happened here. The rail is only as good as its weakest join, so the count and the components joined
that way remain in the delta slot. They sit in its tile menu with the revision, contradictions and
repeated side effects: protocol depth, available where the picture is qualified, and not tall enough to
push the working set out of the first viewport.

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

## Every screen refuses in place

| screen | what stays in its fixed slots when evidence is absent |
| --- | --- |
| Overview | the rail is drawn from what the repository writes down whatever happened, and only the comparison refuses; action ranking refuses without implying safety; the handoff names trace, import or audit; context still reports what the scan could read |
| System map | no parts: what was looked for, and the manifest. Canvas failed: the reason, and that the table beside it is primary |
| Findings | no findings: what that says about the rules rather than about the system. Filters match nothing: a control that clears them. A readiness group nothing falls into is omitted rather than drawn empty |
| Performance | no metrics, no runs, no benchmarks, an overlay with no values: each says which half is missing |
| Resilience | no chaos run: what fault injection measures. Faults requested and not applied: the table, kept visible. Nothing incomplete: said as what these runs reached rather than as a guarantee |
| Scenarios | none defined, and a scenario defined but never run, which are different states |
| Comparisons | none made, and a verdict of insufficient evidence with its sample sizes |
| Goals | none created, naming the first eligible finding. A goal never validated says undecided rather than unproven |
