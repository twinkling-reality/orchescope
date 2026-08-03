# Continue: the report workspace as a full bleed bento

Paste this into a new chat. It is written for a session with no memory of the previous ones.

---

Work in `/Users/glendonchin/dev/Technology/orchescope`. I want to keep redesigning the browser report
workspace in `apps/web`.

**Read first, before touching anything:** `AGENTS.md` for the hard rules, `docs/design/report-system.md`
for what the workspace is built from and why each rule is the rule, `docs/design/CONTINUE.md` for the
two governed layers, and `docs/design/states/README.md` for the state space.

## The loop for looking at it

```
pnpm build:web && pnpm states      # after every source change; states/*.html bake in the CSS and JS
open states/index.html             # one page per real cached report
```

Two things will waste your time if you do not know them:

1. **The pages are standalone exports.** Nothing updates until you rerun both commands, and even then
   a cached tab shows the old build. Hard refresh or append `?v=N`.
2. **The theme is sticky in `localStorage` per origin.** `orchescope.theme` overrides the default. If it
   holds `system` and the machine is dark, you will see a dark page and none of the composition. Clear
   it (`localStorage.removeItem('orchescope.theme')`) before judging anything.

The Chrome extension cannot drive `file://`, so serve the gallery to look at it in a browser:
`cd states && python3 -m http.server 8899`.

Measure against the corpus, not the demonstration. `apps/demo` has 33 components and is the small
unrepresentative case. `crewai` has 987, `openai-agents-python` 1390, `pydantic-ai-exercised` 1727.
Thirteen of the sixteen cached reports have **no run in them**, so the delta refusal is the most looked
at screen in the product. Always check `crewai` (no run, large) and `demo-populated` (a run, rich).

## What already exists, so you do not redo it

Three passes have landed. All green.

- **Top chrome, not a left rail.** Identity left, the eight sections centred on their own row, report
  provenance and controls right. The rail cost 216px of width on every screen; the chrome costs 110px
  of height. `apps/web/src/ui/shell.tsx`.
- **`--column` 1680px, centred.** Prose still caps at 68ch, so width is spent on more columns rather
  than longer lines.
- **`--accent`, one blue, on the chrome and never on the data.** Wordmark, current section, focus,
  selection, checked filters, links. Never a bar cell, map node, presence mark, severity marker or
  number.
- **A token swap makes a surface.** `.block.is-lead` and `.card.is-dark` redefine `--ink`, `--paper`,
  `--sheet`, `--outline` and the alert hues locally, so every existing rule crosses onto the new ground
  intact and fill still means evidence there. The map canvas comes too: `readPalette` in
  `ui/graph-canvas.tsx` reads the same four properties off its own element. **This technique is the one
  to build the bento on.**
- **Overview is a band plus a four card deck**, each card summarising with its detail behind a `···`
  (a `details` element, so it works before the script runs and in page search finds what is inside it
  while closed). `crewai`'s overview now ends above the fold.
- **Map and Findings are `.workbench`**: a 264px filter rail beside the content.

## What I want next: a bento, not panels on a background

Look at `docs/design/report-direction.mock.html` and then at any real report. The problem is that the
page still has a visible background with rectangles floating on it, separated by gutters. **I do not
want a main background colour at all.** I want the viewport filled with tiles that tile it: a wide
band across the top in one colour, a dark tile at the left, light tiles in the middle and right, each
tile owning its own ground, separated by hairlines rather than by gutters of page showing through.
Items and components organised into those tiles. A bento grid.

Concretely, for the Overview first:

- Tiles reach the edges of the content column and meet each other. No gutter of page between them.
- Unequal tile sizes: the delta band spans the full width, then a row where the tiles are not all the
  same width, the way a bento is not a uniform grid.
- Three grounds at least: one accent washed band, one near black tile, the rest near white.
- Detail lives behind the tile's own `···`, so the screen does not scroll.

**Then do the same for Performance, Goals, Resilience, Scenarios and Comparisons.** None of them has a
designed main area yet. Performance is the worst: it opens straight into a per component table with no
statement above it.

### The insight I want you to carry

**In a full bleed bento, a tile's ground is fixed by its role, not by the theme.** A black tile is black
in light and in dark; a white tile is white in both. That is what makes the composition survive a reader
whose machine is dark, which is the case that has broken every version of this so far: on dark, the page
ground, the lifted surface and the accent wash all land within a few points of each other and the whole
thing reads as one grey rectangle. Once the tiles own their grounds there is no page background left to
theme, and the theme control only governs the chrome and the type inside light tiles.

If you agree, say so and do it. If you think it is wrong, argue with evidence rather than going along
with it.

## Hard constraints. Do not quietly drop these for aesthetics.

From `AGENTS.md` and the design record:

- **Fill means evidence, hollow means declared only.** Carried by form, never by hue, so it survives
  greyscale, a colour vision deficiency and a printed page. This holds on the delta bar, the map nodes,
  the components table and the severity marker. A tile ground may change; what a filled shape means may
  not.
- **The two alert hues belong to severity and nothing else.** The accent belongs to the chrome and
  nothing else. A tile ground is a surface, not a mark: nothing may mean something by being on it.
- Manrope and JetBrains Mono, vendored. The primitive set in `ui/primitives.tsx`. Preact. CSP with no
  `unsafe-inline`, no `innerHTML`, an inline style only ever a CSS custom property.
- **Every displayed number carries its basis.** Every empty and refusal state names the command that
  would produce the missing evidence.
- `apps/web` may import only `@orchescope/schema`, and only for types. `pnpm deps` enforces it.
- No `TODO`, no placeholder implementations, no em dashes anywhere in the repository.

**The evidence screens are not bento and pushing them into it would be a real loss.** A components table
of 1727 rows and a findings list carrying every source location are the document this report exists to
be, and the table is the map canvas's only keyboard reachable form. Putting them behind a `···` would
hide evidence a finding is required to carry. Spend the width on them a different way, and tell me if
you think that judgement is wrong.

Do not relitigate the measured map decisions (arrangements, naming thresholds, rank gap) unless this
work forces a concrete conflict. If it does, measure against the corpus before changing them.

## How to work

1. Look at the real pages across several reports before proposing anything. Say which ones you opened.
2. Show me a short plan for the tile geometry before implementing.
3. Implement, then validate across the states gallery rather than the demonstration alone, in both
   themes, and at 390px.
4. Run `pnpm verify` and `pnpm test:ui` before claiming it works, and say what they printed.

`pnpm verify` is 765 unit and integration tests plus 92 end to end. `pnpm test:ui` is 15 browser tests
asserting behaviour rather than appearance: every section reachable, the map's table carrying the same
components as the canvas, filters narrowing both, a finding showing its basis and evidence, an
unavailable action explaining itself, no request to another origin, the shortcut panel by keyboard, the
theme control following the document, navigation by landmarks and headings, visible keyboard focus,
reduced motion respected, and no sideways scrolling at 390px. If markup changes force a test change,
change it deliberately and say so. Do not weaken what it asserts.

Nothing is committed. The working tree already carried a large uncommitted change set before this work
started, so `git diff --stat` is not a measure of what these passes touched.
