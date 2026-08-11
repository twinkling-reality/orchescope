# What the naming and hero pass did not do

Everything here was found while rebuilding the Overview hero and rewriting the language of the eight
screens. None of it was in scope for that pass, and each entry says why, what it would cost, and what
would decide it. Nothing here is a bug report against work that is finished: the entries are choices,
and they are written down so the next session does not have to rediscover them.

Ordered by how much a reader is misled by leaving it.

## 1. The no-run rail counts a different set from the measured one

**Status.** Closed for new bundles. `ReportBundle.summary.observableComponentCount` is optional, baked
in `packages/report/src/bundle.ts` from `isObservableKind`, and consumed by the Overview join tile and
`buildUnmeasuredMeter`. Cached bundles that omit the field fall back to `componentCount`.

**What was wrong.** The rail on a report with a run counted the parts a run can reach. The rail on a
report with no run counted every part the repository writes down. On `crewai` those are 273 and 987.

## 2. Text the analysis packages write still speaks Orchescope

**What is wrong.** Everything `apps/web` composes is now in the reader's words. Everything the engine
hands it is not, and the engine's text is the loudest on several screens.

| where | what a reader sees |
| --- | --- |
| `packages/findings/src/rules/` | `escalate_to_human is declared but never exercised`, `2 relations failed often enough to be worth reporting`, `2 consequential operations have no approval boundary` |
| `packages/goals/` | `orchestrator retries issue_refund, whose effect class is financial` |
| `packages/comparison/` | `sample sizes are 1 baseline and 1 candidate run(s)`, `no graph delta was computed because one side has no scan`, `no metric moved enough to call` |
| `packages/scenarios/src/aggregate.ts:107` | `passed in 1 of the 1 repetitions that ran this evaluator` |

`run(s)` and `1 repetitions` are grammar slips as well as vocabulary, and both sit next to sentences
about how few runs there were, which is the one place a slip reads as a counting mistake.

**Why it was not fixed.** These are the deterministic analysis output. The same strings reach `--json`,
the MCP surface and the goal prompt handed to a coding agent, and a rule's title is asserted by its own
test. Rewording them is a change to the machine contract as well as to the page, and it is a decision
about the product's external vocabulary rather than about its browser workspace.

**What would decide it.** Whether the JSON and MCP surfaces are meant to speak the same language as the
report. If they are, this is one pass over those packages and their tests, and it is worth doing: it is
the largest remaining gap between what a person reads and what a person would say. If the machine
surfaces are meant to stay terse and stable, the report needs a rendering layer over an engine string,
which is a new decision module and a new failure mode. The grammar slips are worth fixing either way and
are independent of that decision.

## 3. The second row of Overview still empties on a tall screen

**What is wrong.** Measured on `demo-populated` at 1920 by 1080: `Fix this first` holds three rows and
about 150px of black under them, and `What the scan could read` has about 200px between its numbers and
its key. The cause is `grid-template-rows: auto minmax(0, 1fr)` in `styles/overview-layout.css`, which
stretches the second row into whatever the hero leaves.

**Why it was not fixed.** The rule was added deliberately, and the alternative it replaced was worse: a
short document that stops halfway down a wide screen reads as having failed rather than ended. The
hero is now taller than the one that rule was written against, so the stretch is smaller than it was,
but it has not gone.

**What would fix it.** Either a fourth thing worth putting in that row, or letting the row stop at its
content and accepting the ground below it, which means answering the question that rule already
answered once. This is taste and it should be argued rather than tuned.

## 4. The hero's flanks are empty on thirteen of sixteen reports

**What is wrong.** A report with no run has no sets to put beside its number, so the band is a centred
figure with about a third of the width empty on each side.

**Why it was left.** There is nothing true to put there. The alternative is to invent a control, and
the reference this composition came from flanks its hero with controls that change what the chart is,
which Orchescope's hero has no equivalent of: one join, over every run in the report, at one revision.

**What would earn the space.** A rail grouped by kind would put agents, tools, models and stores in
their own runs of cells and answer the question a reader asks next, which is which kinds have never
run. It is a real feature rather than a filler: it needs per-group rounding rules, which means opening
the rail's arithmetic again, and it needs its own tests including the empty and the ceiling paths.

## 5. Nothing checks that two stylesheets do not claim the same class

**Status.** Closed. `pnpm styles:check` (`scripts/check-style-classes.mjs`) is part of `pnpm check`
and fails when two files under `apps/web/src/styles/` claim the same class.

## 6. Smaller things, each cheap

- `docs/design/states/*.md` are the historical branch inventory and their `file:line` references have
  moved again. The README already says they are historical; nothing has been regenerated.
- The `···` on the hero sits in the same column as the right hand flank. It does not collide on any
  cached report, because the flank starts 34px below it, but nothing enforces that.
- `format.ts` still holds undocumented constants: every decimal place, the duration scale breaks, the
  currency switch at one dollar and the 200 row windowing threshold. `states/README.md` lists them
  with `taste, undocumented` where that is the truth.
- The map's search field label is two lines at the tool rail's 264px. It was two lines before this
  pass as well.

## 7. The exercise fraction counts a set with one member nobody declared

**What is wrong.** `ReconciliationDelta.coverage.declaredComponents` counts every component a run could
have reached, which on the bundled demonstration includes the one component a run exercised and nothing
declared. So the pair a reader sees, `15 of 22`, has a denominator that is not the declared set and a
numerator that includes the undeclared member on both sides.

**Why it was not corrected here.** `packages/findings/src/rules/runtime.ts:526` and `:545` bake the
uncorrected pair into a finding's own explanation text, in the words
`N of M observable declared components appeared in at least one run`. A terminal that printed a
corrected `14 of 21` beside a finding whose own text says `15 of 22` would contradict itself in one
document. The browser workspace escapes this only because it hides explanations behind a click.

**What the terminal does instead.** It prints `15 of 22 parts a run could reach`, which is true of the
set the numbers actually count, with no percentage derived from it and no branch on magnitude.

**What would decide it.** Whether the delta's coverage pair should describe the declared set or the
reachable set. If the declared set, `packages/graph/src/delta.ts` computes both halves excluding the
components that appear only in a run, `packages/schema` gains no field, and `runtime.ts` is reworded to
match. If the reachable set, the field is renamed in `packages/schema` so no reader has to infer which
set it is, `pnpm schemas` regenerates, and every cached bundle needs `pnpm corpus` to carry the name.
Either way the finding text and the two surfaces that render the pair have to move in the same change.
