# Brief for the next session on the Orchescope report workspace

Copy this whole file into a new chat. It carries what six failed attempts established, so you do not
repeat them. **Read the failures section before you design anything.**

Work in `/Users/glendonchin/dev/Technology/orchescope`.

---

## What I want

The browser report at `apps/web` is not understandable to a person who has not read the documentation.
Fix that. The bar is: **a stranger opens it and, within five seconds, knows one true thing about their
system that they can act on.**

Do not design this by guessing. Use a team of agents. Split the work so that at least these run
independently and then get reconciled:

- one that reads the product docs and states, in one page, what a user of this tool is actually
  worried about before a release;
- one that opens all sixteen cached reports and writes down every string a stranger cannot decode;
- one that designs the composition, from the reference below, against the real data shapes;
- one that adversarially reviews the design against `AGENTS.md` and `docs/product/non-goals.md` and
  tries to find the rule it breaks;
- one that implements, and one that reviews the implementation against the design.

Do not converge on a single opinion early. I would rather see three designed options with the trade
named than one that gets iterated seven times.

## Read first, in this order

1. `AGENTS.md`
2. `docs/product/vision.md`
3. `docs/product/non-goals.md`
4. `docs/design/report-system.md`
5. `docs/design/CONTINUE.md`
6. `docs/design/TODO.md`
7. `docs/design/states/README.md`

## Before you change anything

```
pnpm build:web && pnpm states
python3 -m http.server 8765 --directory states
```

Open `demo-populated` (the only report with runs, goals, a benchmark and a chaos run), `crewai` and
`openai-agents-js` (large, no runs), `demonstration-system` (small, no runs), `pydantic-ai-exercised`
(1727 things, one run, 950 of 952 never ran) and `orchescope-discovery` (declares nothing). Look at
1280x800, 1728x950 and 390x844. Thirteen of the sixteen have no runs: that is the common case.

---

## The reference, and what it actually teaches

The image I keep sending is a notifications dashboard. Its hero is `Completed Interactions` and
`13,159,201`. Four things on the band: a label, a number, a line chart, and the days under it. Its
lower row is four tiles on three grounds, every one of them dense, two of them with buttons.

**What is transferable:**

- One number rings out because nothing else on the band is above 16px. Hierarchy by size, hard.
- Every tile answers a different question. None repeats another.
- Every tile has an action or a way in.
- Four distinct surfaces on one screen: pale band, saturated band, black tile, white tiles.
- Controls are quiet dots and words in the corners, never a loud segmented button.

**What is not transferable, and this cost me most of a session:**

- Its chart is a week of a time series. It has shape worth drawing at full page width. Orchescope has
  counts. **A count breakdown stretched across 1700px is not a visualization, it is wallpaper**, and the
  widest segment ends up being the least important one, so the picture shouts the wrong thing.
- Its numbers move between visits. This report is a document you read once. Do not build a dashboard
  for something that is not in flight.

---

## The six things that failed, and why

Do not do these again.

1. **Rewording.** Two full passes rewriting every string on every screen into plain English. `component`
   became `part`, `exercised` became `seen running`, `polarity` became `good or bad news`. The user's
   verdict: *"no rewording or anything helps me understand it or its value at all"*. Wording was never
   the fault.

2. **Leading with the join.** `7 of 21 things never ran` was the hero for five rounds. It is a fact about
   the quality of *our own measurement*, not about the reader's system. Nothing makes it worth reading
   first. It is now a tile.

3. **Inventing a picture out of counts.** A full bleed severity bar, then a full bleed rail. Both were
   the loudest object on the page while carrying the least. The rail on a report with no run draws N
   identical dashed cells, which is one bit of information, the length, that the number beside it
   already gives in full.

4. **Adding density.** Percent, bar, supporting counts and a button on every tile. It made the screen
   busier without making any one thing findable. The user's verdict: *"I see a million things at once
   but nothing rings out."*

5. **Deleting everything.** The opposite over-correction. Overview became one answer on one flat
   lavender rectangle, with 400px of empty colour under the fold. The user's verdict: *"why is the whole
   thing one colour"*. The tiles were never the fault. What they held was.

6. **Asking which direction to go.** Twice, with previews. It did not converge, and it burned the
   user's time. Design it properly, present it whole, and be ready to defend it.

## The diagnosis that survived all six

**The screen answered `what do I do` in four places at once, and two of them printed the same finding
twice, two hundred pixels apart.** A hero naming the most serious problem, a tile listing the top three,
a tile naming a goal to hand off, and a tile about how many files the scan managed to read. A reader
given four answers has been given none.

That is the root fault. Every other complaint downstream of it — too much, nothing rings out, it
scrolls, it is all one colour — is a symptom of the count of answers, not of typography, colour or
wording.

## Where it stands now

Overview is `headline`, `problems`, `ran`, `scan`. The headline is the single most serious finding, what
it costs, and the one command that starts fixing it. The three tiles under it each ask a different
question and none repeats the headline, and there is a test that fails if one does.

`pnpm verify` exit 0. `pnpm test:ui` 18/18. **The seven depth screens have had none of this and still
have every problem listed above.**

Known and unfixed:

- Overview scrolls about 25 to 45px on an 800px tall viewport. It fits at 950 and above.
- Finding titles come from `packages/findings` and still say `declared`, `exercised`, `relation`. They
  reach `--json` and MCP too, so rewording them is a machine contract change. See `TODO.md` item 2.
- `docs/design/TODO.md` holds five more, each with the cost and what would decide it.

---

## Rules that are not negotiable

From `AGENTS.md` and `docs/product/non-goals.md`. An agent that breaks one of these has produced work
that cannot ship, so put the adversarial reviewer on exactly this list.

- **Evidence or silence.** Every displayed number carries its basis: observed, discovered, inferred,
  estimated, simulated, model interpreted. A finding with no evidence is not reported. A metric with no
  sample size is not reported.
- **Never fake completeness.** Missing runs, benchmarks, goals or measurements stay visibly unavailable
  with a reason and the command that would produce them. Thirteen of sixteen reports have no runs.
- **Fill means measured.** A hollow outline was only declared. A dashed mark means no run could say. It
  is carried by form, never by hue, so it survives greyscale.
- **Hue belongs to severity and the chrome.** If you want colour doing more, argue the trade explicitly.
- **No model in the analysis loop.** Nothing calls a model. There is no setting that changes it.
- **Not a fixer.** No auto-fix, apply-patch, dismiss, acknowledge or UI-only resolution. The report
  produces a bounded goal; a person or a coding agent makes the change.
- **A control the configuration cannot perform is absent, or disabled with its reason shown.**
- `apps/web` may import only `@orchescope/schema`, types only. `pnpm deps` enforces it.
- CSP is strict: no `innerHTML`, no remote assets, an inline style is only ever a CSS custom property.
- Presentation modules select, sort, group and bound existing bundle facts. They never analyse again.
- One concept per file. No `utils`, `helpers`, `common`. Split around 400 lines.
- Every new pure decision module needs tests, including empty and refusal paths.
- Keep all eight tabs. Preserve deterministic ordering, map coordinates, keyboard navigation and
  responsive behaviour.
- No em dashes anywhere in the repository.

## What must pass

`pnpm verify`, `pnpm test:ui`, `pnpm package`. If markup changes force a test change, change it
deliberately and say so, and do not weaken what it asserts. There is a CSS class collision hazard the
build does not catch: `controls.css` already owns `.progress`, and a new primitive that reused the name
rendered at the other rule's height and fallback width. Check for name clashes by hand.

## How to report back

Say what you ran and what it printed. Show the built pages at all three viewports across at least the
five report regimes above. Say what is still weak. Do not claim success because tests pass.
