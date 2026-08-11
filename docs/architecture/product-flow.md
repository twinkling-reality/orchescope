# Product flow

The product is one five step loop. Every surface exists to run that loop, not to host a dashboard.

```
1 audit ──► 2 goal ──► 3 change ──► 4 rerun ──► 5 did it help
                ▲                         │
                └──────── same scenario ──┘
```

1. **Audit** reads source and any stored runs, reconciles declared against exercised, and emits findings with evidence.
2. **Goal** turns one finding into a bounded task: scope, acceptance criteria, and the command that decides the outcome.
3. **Change** is made by a person or a coding agent. Orchescope does not edit the repository.
4. **Rerun** executes the same scenario with the same seed so the comparison is attributable.
5. **Did it help** compares baseline against candidate and returns a verdict with sample sizes, or refuses to call it.

The value is in step five. An audit alone is inventory; the loop is the product.

## Surfaces, and what each is for

| Surface | Package | Role in the loop |
| --- | --- | --- |
| CLI | `apps/cli` | Primary human entry. Runs every step, prints a document that says where you stand and what to type next. |
| JSON | CLI `--json` | Machine contract for CI and scripts. Same use cases, one document shaped `{ ok, command, version, data }`. |
| MCP | `packages/mcp` | Same use cases for a coding agent, with bounded output and explicit schemas. |
| Report server | `packages/report-server` | Loopback host for the browser workspace. No analysis of its own. |
| Browser workspace | `apps/web` | Read-only view of one report bundle. Selects and renders; never re-analyses. |

The CLI is the product people install. The browser workspace is a report reader for the bundle the CLI (or MCP) already wrote. MCP is how an agent runs the same loop without scraping a terminal. None of them is a hosted service.

## Separations that must hold

```
schema ──► domain ──► core analysis ──► usecases ──► edges (cli, mcp, report-server)
                                              │
                                              └── report bundle ──► apps/web (types only)
```

- **Analysis stays in core packages.** Findings, reconciliation, comparison and goals are pure over evidence. Presentation never invents a verdict.
- **Use cases are the only composition root the edges call.** CLI and MCP do not touch persistence.
- **The report bundle is the freeze line.** Layout, overlays and summary counts are baked when the bundle is written so every surface agrees.
- **Browser presentation is swappable.** Pure binders under `apps/web/src/presentation/` decide what each slot holds. `apps/web/src/ui/` and `apps/web/src/sections/` only render those decisions. Replacing the skin must not require touching analysis or binders.
- **Terminal presentation mirrors that split.** Pure row modules under `apps/cli/src/terminal/` select and bound bundle facts; `audit-document.ts` only orders regions.

## What a stranger should understand in five seconds

- CLI default output: what the worst finding is, where you stand in the five steps, and the one command that advances the loop.
- Browser Overview: the worst finding and the one command that starts fixing it. Depth screens answer one question each.
- MCP or JSON: the same facts without prose chrome, for an agent or a gate.

If a change makes any surface answer "what do I do" in more than one place, it has regressed the root fault recorded in `docs/design/NEXT-SESSION.md` and `docs/design/TUI-NEXT-SESSION.md`.
