# Every state the report workspace can be in

The workspace renders one structural page per screen. Overview always carries delta, top actions, next
commands and context. Every other screen always carries summary, primary and detail. What fills a slot
depends on the report bundle, and missing evidence refuses in that slot instead of changing the tree.

This directory exists to compare those stable frames across real report regimes before changing them.
It has two halves and they answer different questions.

## To look at a state: `pnpm states`

```
pnpm build:web
pnpm states
open states/index.html
```

Every bundle under `corpus/.cache/bundles` is a real report of a real repository, produced by
`pnpm corpus`. `pnpm states` renders each one as a standalone page, the same single file export the
product already ships, and writes an index saying which states each report reaches. The flags in that
index are computed from the bundle rather than described, so they cannot go stale against a threshold
that has moved.

Sixteen real reports, and this is what they get you:

| report | components | drawn | findings | runs | why you would open it |
| --- | --- | --- | --- | --- | --- |
| `orchescope-discovery` | 0 | 0 | 0 | 0 | every screen at its emptiest, and a repository that declares nothing |
| `flask` | 4 | 4 | 1 | 0 | the smallest thing that is still a system |
| `express` | 5 | 5 | 1 | 0 | as above |
| `axios` | 8 | 8 | 1 | 0 | as above |
| `demonstration-system` | 32 | 25 | 7 | 0 | scenarios defined and never run, which no other report has |
| `demo-populated` | 33 | 26 | 21 | 10 | the only report with a benchmark, a chaos run, a comparison or a goal |
| `vercel-ai-chatbot` | 41 | 35 | 4 | 0 | strengths beside risks |
| `vercel-ai-chatbot-exercised` | 43 | 35 | 7 | 1 | a delta on a small repository |
| `anthropic-quickstarts` | 53 | 17 | 4 | 0 | a map that leaves out two thirds of what it found |
| `langgraphjs` | 709 | 329 | 2 | 0 | a map with room for 30 of its 329 names, and only two findings |
| `openai-agents-js` | 768 | 417 | 5 | 0 | the most drawn of any report, and the densest canvas |
| `langgraph` | 852 | 288 | 3 | 0 | as above, with a third of the components drawn |
| `crewai` | 987 | 150 | 5 | 0 | the widest gap between found and drawn, at 15 percent |
| `openai-agents-python` | 1390 | 298 | 6 | 0 | a hub and spoke system at scale |
| `pydantic-ai` | 1726 | 678 | 6 | 0 | the largest static report |
| `pydantic-ai-exercised` | 1727 | 679 | 8 | 1 | the delta bar in proportion mode, at 0.3 percent exercised |

The drawn column is what the map actually lays out, which is not the same as the components an edge
names: an edge can point at a component the graph does not carry, and 104 of crewai's 243 do.

`demo-populated` is not produced by `pnpm corpus`. Make it with:

```
pnpm orchescope --cwd apps/demo export --format json --out corpus/.cache/bundles/demo-populated.json
```

after the demonstration has runs in it. `pnpm tour --keep` keeps whatever is already there.

## Historical decision inventory: the files beside this one

The totals below count branches in the workspace before the fixed presentation contract. They document
edge evidence and protocol vocabulary, but they are not the product's mode matrix and are not a target
for completeness. Design work should concentrate on no run, run with findings and goals, then use the
gallery to catch regressions in the other reports.

| file | states | blocks | thresholds | reached by no report here |
| --- | --- | --- | --- | --- |
| [overview.md](overview.md) | 169 | 8 | 12 | 59 |
| [system-map.md](system-map.md) | 142 | 37 | 18 | 24 |
| [findings.md](findings.md) | 114 | 40 | 8 | 35 |
| [performance.md](performance.md) | 93 | 8 | 12 | 47 |
| [resilience.md](resilience.md) | 78 | 25 | 12 | 39 |
| [scenarios.md](scenarios.md) | 72 | 13 | 9 | 41 |
| [comparisons.md](comparisons.md) | 92 | 36 | 9 | 62 |
| [goals.md](goals.md) | 146 | 24 | 10 | 79 |
| [shell.md](shell.md) | 78 | 23 | 7 | 28 |
| [vocabulary.md](vocabulary.md) | 153 | 103 | 14 | 51 |
| | **1137** | | **111** | **465** |

Each row of each file gives the state, the exact data predicate that selects it, the `file:line` of the
branch, and which report shows it. Where no report shows it, the last column says what edit to a named
bundle would.

Read [vocabulary.md](vocabulary.md) first whatever you are working on. It covers the ten primitives and
the formatters, which every screen inherits: `Eyebrow` has 77 call sites and `RefusalPanel` has 26, so a
change to either is a change to all eight screens at once.

## The part worth knowing before you start

**The historical inventory includes 465 branches reached by no report in the cache.** Nothing shows
them to you. They are not exotic: they include a severity of `critical`,
which the severity mark's only two element form exists for; the basis `model_interpreted`, which is the
only two word chip label and the one that will wrap in a table cell; every branch of the currency
formatter, because no run in any report has ever reported a cost; and a capability that is absent rather
than declared and unavailable, which is one of the three states every action control is specified to
have.

**111 constants switch a representation, and most of them are undocumented taste.** The map no longer
has a naming ceiling at all: it works out from the drawing itself which names are clear, so the two
numbers it switches on are measured per report rather than chosen. The delta bar's 120 is a readability
judgement and says so. The rest, including every decimal place in `format.ts`, the duration scale breaks, the
currency switch at one dollar and the 200 row windowing threshold, are choices nobody wrote a reason
for. They are all listed with a `Why that number` column that says `taste, undocumented` where that is
the truth, so you can tell which ones you are free to move.

**The thing that produces the most surprising screens is a report with a run in it.** Only three of the
sixteen have one, and only one has a benchmark, a chaos run, a comparison or a goal. That is why five
sections had never been seen with data before phase 21. If you are changing Performance, Resilience,
Scenarios, Comparisons or Goals, `demo-populated` is the only report that will show you anything at all,
and it will not show you most of what those screens can do.

## How much to trust this

The tables were derived by reading every branch in `apps/web` and the modules it calls, at the revision
this directory was added. The `file:line` references are the check: a claim you doubt is one file open
away from settled, and a line that has moved is a sign the state may have moved with it.

**All ten inventory files are historical.** The fixed skeleton changed every section frame, navigation
now keeps zero counts visible, Overview has a new four-slot order, and several section files moved into
responsibility-named directories. The predicates can still reveal an evidence edge worth testing, but
their block names, line references and totals do not describe the presentation contract.

The gallery is the empirical half and does not go stale in the same way, because it renders whatever the
bundles and the current build actually produce. When the two disagree, the gallery is right.

One thing it will not do is show you a bundle it cannot trust. Map coordinates are computed once, by
the process that writes the bundle, so a stored bundle carries the layout of whatever build wrote it.
Rendering old coordinates with a new canvas produces a picture that is wrong in a way nothing on the
page admits to: the layered coordinates this repository used before the ring layout put every component
of a large repository on three x values, which the current canvas draws as a vertical column of
overlapping dots, and a reader cannot tell that from a system that really is a column. `pnpm states`
recomputes the layout, compares, and refuses the bundle rather than drawing it, naming `pnpm corpus` as
the way to refresh it. Those old coordinates were a layered layout with one rank per line, which is not
the directional arrangement the picker now offers: that one wraps a rank into a block, and the column of
dots is what it was built to avoid.

A bundle can carry more than one arrangement of the same graph, so the check knows which one it is
comparing: each arrangement is recomputed against its own metadata keys, and only the ones the bundle
actually carries are checked. A bundle written before the directional arrangements existed carries only
the concentric coordinates, which is one arrangement rather than a stale one; it renders, and the picker
is absent. The same process is the only one that loads both the module that writes those keys and the
module that reads them, so it also refuses to run at all if the two lists have drifted apart.

Regenerate the gallery after any change to `apps/web`, to `packages/report`, or to anything that decides
what reaches a bundle. It takes a few seconds and it is the only way to see what a change did to the
fifteen reports you were not thinking about.
