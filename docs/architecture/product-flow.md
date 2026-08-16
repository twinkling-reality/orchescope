# Product flow

The product is one five step loop. Every surface exists to run that loop.

```
1 audit ──► 2 goal ──► 3 change ──► 4 rerun ──► 5 did it help
                ▲                         │
                └──────── same scenario ──┘
```

1. **Audit** reads source and any stored runs, reconciles declared against exercised, and emits findings with evidence.
2. **Goal** turns one finding into a bounded task: scope, acceptance criteria, and the command that decides the outcome.
3. **Change** is made by a coding agent (or a person). Orchescope does not edit the repository.
4. **Rerun** executes the same scenario with the same seed so the comparison is attributable.
5. **Did it help** compares baseline against candidate and returns a verdict with sample sizes, or refuses to call it.

The value is in step five. An audit alone is inventory; the loop is the product.

## Surfaces

| Surface | Package | Role |
| --- | --- | --- |
| MCP | `packages/mcp` | Primary agent entry. Same use cases, bounded output, explicit schemas. |
| CLI `--json` | `apps/cli` | Machine contract for agents and CI. One document shaped `{ ok, command, version, data }`. |
| CLI terminal | `apps/cli` | The only human UI: progress while work runs, then a short document. |
| SARIF / Mermaid | `packages/report` | Optional exports for scanners and pull requests. |

There is no browser workspace and no report server.

## Separations that must hold

```
schema ──► domain ──► core analysis ──► usecases ──► edges (cli, mcp)
```

- **Analysis stays in core packages.** Findings, reconciliation, comparison and goals are pure over evidence.
- **Use cases are the only composition root the edges call.** CLI and MCP do not touch persistence.
- **Terminal presentation is swappable.** Pure row modules under `apps/cli/src/terminal/` select and bound bundle facts;
  they never invent a verdict.
- **One next action, shared.** `loopProgress` and `resolveNextAction` in `packages/report` decide standing and the
  single advance. The terminal renders it; `audit --json` and `audit_agent_system` return the same decision.
- **Agents never scrape the TUI.** They use MCP or `--json`.

## What a stranger should understand in five seconds

- Terminal: what was audited, what the worst findings are, what the loop has not produced yet, and the one command that
  advances it. The five steps themselves are `--verbose`; the default names where you stand by naming what is missing.
- MCP or JSON: the same facts without prose chrome, for an agent or a gate.

If a change makes the terminal answer "what do I do" in more than one place, it has regressed the root fault recorded in
`docs/design/TUI-NEXT-SESSION.md`.
