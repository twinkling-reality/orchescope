# Open product decisions after the browser cut

The browser workspace, report server, standalone HTML export and Playwright UI suite are gone. What remains
below is what still needs work for the agent-first product, ordered by how much a reader or agent is
misled by leaving it.

## Settled directions (do not reopen without new evidence)

### Next action is one shared policy

`loopProgress` and `resolveNextAction` in `packages/report` own standing and the single advance. The
terminal, `audit --json` and `audit_agent_system` render or map that decision. Agents must not scrape
the TUI.

### Baseline before goal when there are no runs

When `bundle.runs.length === 0`, the goal step must not own the pasteable advance even if eligible
findings exist. Standing walks to `rerun` (scenario present) or `measure` (`trace`). Goals whose
acceptance criteria include metric comparisons cannot close step five without a baseline; offering
`goal create` first invents a handoff that validate cannot decide.

Encoding: null `goal.command` when there are no runs. Keep `standingAt` as the first incomplete step
that carries a command. Do not reorder the five product steps.

### MCP must be able to ingest a run

`import_trace` (no spawn) and `run_traced` (argv array, `policy.allowProcessSpawn`, refuse rather than
downgrade) are the twins of the CLI. Map them in `loop-action`. Never silently remap wrap to import.
Never execute the placeholder `<the command that starts your system>`.

### Coverage pair means the declared set

Long term, `coverage.declaredComponents` / `exercisedComponents` / `componentExerciseRate` describe
observable components with `presence.static`, and how many of those also have `presence.runtime`.
Undeclared components stay in `exercisedNotDeclared` only. Change `delta.ts`, the
`observability-coverage` finding text, TUI join label, and schema comments in one atomic change. Do
not quietly correct the fraction alone.

### Vocabulary is one language

Findings, goals, comparison, MCP summaries and the terminal speak the same nouns. Schema delta keys
(`declaredNotExercised`, …) stay technical. Finding titles drop engine-only phrasing (`relation`,
`run(s)`) where a human or agent reads them. Same-language pass, not a second rendering dictionary.

### Join stays its own region; zeros stay news

Findings stay above join. The join region stays absent when there are no runs. Zero deltas still
render when a run was reconciled: a zero is the difference between "looked and clear" and "never
looked." Collapsing zeros is rejected. The four delta counts pack onto two lines under the fraction
without dropping zeros or inventing a percentage.

## Implementation sequence

| Tranche | Work | Status |
| --- | --- | --- |
| 1 | Baseline-before-goal; MCP `import_trace` + `run_traced` + loop-action mapping | done |
| 2 | Coverage pair (declared-set) atomic across graph, finding, TUI, schema comments | done |
| 3 | Vocabulary / grammar pass over findings, goals, comparison, MCP chrome | done |
| optional | Join delta packing (keep zeros, shrink line count) | done |

## Notes that remain true

- Value is step five. An audit alone is inventory.
- No browser, dashboard, HTML report, or second UI.
- Colour carries nothing a symbol and a word do not already say.
- Refuse rather than downgrade.
