# The terminal document

Orchescope has one human interface: the document `orchescope audit` prints to a terminal. This file records why that
document is shaped the way it is, so a change to it can be argued against the reasoning rather than against taste.

The browser workspace, the report server and the standalone HTML export were removed. Coding agents read MCP and
`--json`; people read the terminal.

## What the document is for

A reader should be able to answer three questions in about five seconds: what was found, where the repository stands in
the five step loop, and which single command advances it. Everything else is subordinate to those three.

The design targets are `apps/demo` and `corpus/.cache/crewai`. One is the bundled fixture with declared weaknesses in
it; the other is a third party repository the adapters were not written against. A document that reads well for only
one of them has been tuned to a fixture.

Indentation, colour and animation carry the structure. Animation runs only while work runs. Colour is redundant by
construction: every distinction it draws is also drawn by a symbol and a word, so `NO_COLOR` loses nothing.

## Decisions that hold

- **The product is the loop.** audit → goal → change → rerun → did it help. The value is step five, so the document
  names what the loop has not produced yet rather than leading with inventory.
- **Agents are the primary operators.** People install the CLI and glance at it.
- **No score out of 100.** A single number implies a measurement that nothing performed. The fraction the document
  prints instead is check suite coverage, which is counted.
- **Presentation selects, it never analyses.** The row modules under `apps/cli/src/terminal/` bound and order facts the
  bundle already holds. A verdict computed while rendering cannot be reproduced through `--json`.
- **One next action, decided once.** `loopProgress` and `resolveNextAction` in `packages/report` own standing and the
  single advance. The terminal renders that decision; `audit --json` and `audit_agent_system` return it.
- **A baseline outranks a goal when there are no runs.** With `bundle.runs.length === 0`, standing walks to `trace` or
  a scenario rather than to `goal create`. Acceptance criteria that compare metrics cannot close step five without
  something to compare against, so offering a goal first hands the reader a task validation cannot decide.
- **Ingest has two twins.** `import_trace` and `run_traced` are the only ways a run enters the store. The placeholder
  command the document prints is text for a person to run, never something a surface executes.

## Shapes that were tried and rejected

- **Rewording without restructuring.** Changing sentences while leaving the region order alone does not help a reader
  who still has to assemble standing from three places. The vocabulary is rarely the fault.
- **Join coverage as the headline.** It is the defensible measurement, which makes it tempting to lead with. Led with,
  it reads as a verdict on the repository rather than a statement of how much has been traced, and it pushes the
  findings off the first screen. Findings come before the join.
- **Pictures drawn from counts.** Bars and sparklines derived from finding counts or run totals imply a distribution
  the counts do not carry. A number with its basis stated is honest where a shape is not.
- **Answering "what do I do" in more than one place.** A next action computed separately for the terminal and for
  `--json` can disagree, and it disagrees where the reader has least context to notice. `resolveNextAction` exists so
  the decision is made once.
- **Empty frames.** A region with nothing to show should not render as an empty box. A refusal naming the command that
  would produce the missing data is shorter and says more.

## Where the document lives

| File | What it holds |
| --- | --- |
| `packages/report/src/loop-progress.ts` | The five steps, standing, and one `nextCommand` |
| `packages/report/src/next-action.ts` | The shared next action for the terminal, `--json` and MCP |
| `packages/report/src/commands.ts` | The argv strings the next action prints |
| `apps/cli/src/terminal/document-grid.ts` | Anchors, tiers and row kinds |
| `apps/cli/src/terminal/audit-document.ts` | Region order, findings before the join |
| `apps/cli/src/terminal/progress-renderer.ts` | Transient progress |

## Verifying a change to it

`pnpm verify` is the gate. Past it, a change to the terminal is judged by looking at the output rather than at the exit
code: at 80 and 120 columns, under colour and `NO_COLOR`, piped as well as attached, for both `apps/demo` and
`corpus/.cache/crewai`.

## Related

`docs/product/vision.md`, `docs/product/non-goals.md` and `docs/architecture/product-flow.md` hold the product
decisions this document renders.
