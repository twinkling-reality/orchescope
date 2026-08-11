# Brief for the next session on the Orchescope terminal

The browser workspace is gone. The only human UI is the terminal. Coding agents use MCP and `--json`.

Work in `/Users/glendonchin/dev/Technology/orchescope`.

## What I want

A terminal document that makes a human feel productive in under five seconds: what was found, where they stand in the
five step loop, and the one command that advances it. Indentation, colour and animation while work runs. Colour carries
nothing a symbol and a word do not already say.

Do not rebuild a website. Do not ask which direction to go. Design against `apps/demo` and `corpus/.cache/crewai`.

## Read first

1. `AGENTS.md`
2. `docs/product/vision.md`
3. `docs/product/non-goals.md`
4. `docs/architecture/product-flow.md`
5. This file's failures section

## Settled

- The product is audit → goal → change → rerun → did it help. Value is step five.
- Agents are the primary operators. Humans install and glance.
- No score out of 100. Honest fraction is check suite coverage.
- Presentation modules select and bound bundle facts. They never analyse again.

## Failures not to repeat

- Rewording alone
- Leading with join coverage as the hero
- Inventing pictures out of counts
- Answering "what do I do" in more than one place
- Empty frames instead of refusals with a command

## Files that hold the document

| file | what it is |
| --- | --- |
| `packages/report/src/loop-progress.ts` | five steps, standing, one `nextCommand` |
| `packages/report/src/next-action.ts` | shared next action for TUI, `--json`, MCP |
| `packages/report/src/commands.ts` | argv strings the next action prints |
| `apps/cli/src/terminal/document-grid.ts` | anchors, tiers, row kinds |
| `apps/cli/src/terminal/audit-document.ts` | region order (findings before join) |
| `apps/cli/src/terminal/progress-renderer.ts` | transient progress |

## What must pass

```
pnpm verify
```

Show output at 80 and 120 columns, colour and `NO_COLOR`, piped, for `apps/demo` and `corpus/.cache/crewai`.
