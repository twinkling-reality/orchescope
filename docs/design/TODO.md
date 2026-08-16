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

`import_trace` (no spawn) and `run_traced` (argv array, `execution.allowProcessSpawn`, refuse rather than
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
`run(s)`) where a human or agent reads them. Graph inventory counts `edge`s, matching the schema,
rather than renaming them to `relation` at the surface. Same-language pass, not a second rendering
dictionary.

### Join stays its own region; zeros stay news

Findings stay above the reconciliation region. That region stays absent when there are no runs. Zero
deltas still render when a run was reconciled: a zero is the difference between "looked and clear" and
"never looked." Collapsing zeros is rejected. Full product nouns on four delta rows win over packing
that shortens them. The surface key is `system` (the subject), not `join` (the engine verb).

### Terminal glance answers four questions

Default `audit` answers, in this order: what was audited, what is wrong, what is still missing, what to
run. Line one names the project by what it contains (agents, tools, models) rather than by a part
count, because a size is not a description and a bare folder name in column one reads as a mode. Line
two is coverage and the run count. Then the three worst problems, then any gap that blocked reading,
then the `missing` row and the one command, adjacent, because a reason and the command it justifies
are one thought. No five step loop, no system deltas, no evidence tails, no meters of any kind.
`--verbose` restores the spine in plain language ("parts in the code", not "declared/exercised") and is
where identifiers, exact severities, confidences and evidence bases live, along with `--json` / MCP.
No scores, no invented percentages, no interactive tabs or chords.

### Severity is a key, and a chip is a word

A problem row is keyed by `serious` / `medium` / `minor` and carries no state field. `problem  ! HIGH
<title>` spent the two widest columns saying one thing twice and left fifty columns for a sentence that
needed more, and `HIGH` is an engine token. The five severities are exact and stay in `--verbose`,
`--json` and MCP. A coloured severity is painted before the grid pads it, so the background is the
width of the word; an eleven column bar with a six character label in it is the failure this rule
exists to prevent. `NO_COLOR` loses nothing, because the word carries the whole signal.

### The verdict is a result, not an absence

The default `audit` can state a decided verdict. `improved` and `regressed` both mark step five done, so
a closed loop used to print "nothing: every step of the loop is done" whether a change had helped or had
broken the system, which is a referee announcing a loss as a win. A decided comparison gets a row keyed
by its own outcome word; `missing` keeps naming what is absent and is dropped when a verdict has closed
the loop. `unchanged` and `insufficient_evidence` are not verdicts and still render as `missing`.

Downstream of the same rule: `compare` exits non-zero on `insufficient_evidence` and `mixed`, not only
on `regressed`, because zero means a gate may proceed. The compare table draws `unchanged` and
`indeterminate` as different marks (`=` and `?`), since "did not move" and "cannot tell" are the
distinction the product exists to make. `goal validate` prints `validated` / `not validated` as a word
and names the comparison that decided it.

## Implementation sequence

| Tranche | Work | Status |
| --- | --- | --- |
| 1 | Baseline-before-goal; MCP `import_trace` + `run_traced` + loop-action mapping | done |
| 2 | Coverage pair (declared-set) atomic across graph, finding, TUI, schema comments | done |
| 3 | Vocabulary / grammar pass over findings, goals, comparison, MCP chrome | done |
| 4 | Glance rework: kind headline, severity keys, `missing` row, hugging chips | done |
| 5 | Verdict as a result: outcome row, compare exit codes, direction marks, `validated` as a word | done |
| 6 | "Did the last change help" as one selection, shared by terminal, `--json` and MCP, with no identifier | done |
| next | Let an agent author its own scenario. The rescan criterion still catches it, because it did not write the rule | open |
| next | Prove the loop closes on a repository nobody designed for it. Without that, the referee has no consumer | open |
| optional | Join delta packing (keep zeros, shrink line count) | reverted: full nouns |

## Notes that remain true

- Value is step five. An audit alone is inventory.
- No browser, dashboard, HTML report, or second UI.
- Colour carries nothing a symbol and a word do not already say.
- Refuse rather than downgrade.
