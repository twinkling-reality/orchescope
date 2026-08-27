# Goal lifecycle

A finding says what is wrong. A goal says what to change, what may be touched, and the command that decides whether the
change worked. It is the unit of work handed to a person or a coding agent.

```
finding (goal eligible)
    │  orchescope goal create <finding-id>
    ▼
goal (draft → ready) ──► agent prompt, markdown, or JSON
    │  a person or an agent makes the change
    ▼
rerun the same scenario, same seed ──► candidate runs
    │  orchescope compare <baseline> <candidate> --goal <goal-id>
    ▼
comparison ──► orchescope goal validate <goal-id> --comparison <id>
    │
    ▼
validated | rejected, per criterion, with what was undecided named
```

## Eligibility comes first

Not every finding should become a goal, and offering a button that produces a bad one is worse than offering nothing. Each
finding carries `goalReadiness`:

- **`eligible`**, whether a bounded change exists whose outcome can be measured;
- **`reason`**, stated either way, so a refusal is explained;
- **`requiresRuntimeEvidence`**, when the finding needs runs before it can be acted on;
- **`requiresHumanReview`**, when the change is a design decision rather than a fix.

A resilience finding that says "a single dependency failure ends the task" is not eligible: how to degrade is a design
choice. A duplicated refund is eligible: attaching an idempotency key is local, and rerunning the same scenario with the
same seed decides it.

## What a goal is judged against

The scenarios a goal reruns and the runs it compares against are one question, not two. A comparison means
something only when both sides reproduce the same work, so both come from the same evidence: the audit
records, per run, which components that run executed, and the goal asks which recorded runs exercised the
components its finding names. That is the declared against exercised join asked backwards, and it is a
scoped query rather than a window over recent runs.

Nothing is matched by name. A scenario is chosen because runs of it were recorded executing the components,
never because its tags read like them, and a scenario recorded covering more of what the finding names is
preferred over one covering less.

The baseline is one stored scenario result, whole, with the conditions it was recorded under: the scenario,
the variant and the fault plan. The plan reruns that scenario under those conditions, so the two sides are
two executions of the same work. Where no such pair exists, and a repository with no scenario is the normal
case, the goal states no metric criterion, prescribes no comparison, and says which question failed rather
than only that something is missing.

## What a goal contains

- **`id`**, `OSC-GOAL-NNNN`, sequential per project and readable, derived from the identifiers already stored rather than
  from a row count.
- **`findingId`**, the finding it came from.
- **`problemStatement`**, what is wrong, in plain terms.
- **`evidence`** and **`evidenceSummary`**: the evidence identifiers, plus a copy of the salient values with their basis, so
  the goal is still readable after a rescan has replaced the finding.
- **`affectedComponents`** and **`sourceLocations`**, where the change belongs.
- **`scope`**: `allowedWritePaths` (at least one), `prohibitedChanges`, `invariants` that must keep holding, and
  `requiredApprovals` from `human_review`, `live_execution` and `cost_budget`.
- **`risk`**: `low`, `medium` or `high`.
- **`acceptanceCriteria`**, at least one, each `AC-NN` with a checkable statement and a check of a known kind.
- **`validation`**: the scenarios to rerun, the baseline runs to compare against and the conditions they were
  recorded under, or why no comparison is prescribed; the exact commands with their purpose, the number of
  repetitions, and whether validating needs to execute the system rather than only analyse it.
- **`expectedImprovement`**, stated as a direction and a magnitude where the evidence supports one.
- **`rollback`**, how to undo the change if validation fails.
- **`validationResults`**, every comparison that judged it, newest last.

## Acceptance criteria are checkable

Six kinds, and two of them are deliberately never decided automatically:

| Kind | Decided by |
| --- | --- |
| `metric_improvement` | a metric moved in the right direction, optionally past a relative or absolute threshold |
| `metric_not_worse` | a metric stayed within a tolerance, with direction taken from the comparison rather than guessed |
| `scenario_passes` | the named scenario passed when rerun |
| `finding_resolved` | the finding no longer fires after a rescan |
| `command_succeeds` | never decided here: the command is the implementer's step and its exit status is not recorded in the store |
| `manual_review` | never decided here: a person records it |

Every criterion outcome carries three fields: `satisfied`, `decided` and a `detail` sentence. The middle one matters. A
criterion that could not be judged is reported as undecided rather than as failed, because "we could not tell" and "it did
not work" are different answers and only one of them means stop.

## Statuses

`draft` → `ready` → `in_progress` → `validated`, with `rejected` and `abandoned` as terminal alternatives. A goal reaches
`validated` only when every criterion is satisfied. One undecided criterion is enough to keep it out.

## Three renderings, one document

- **`--prompt`** renders the prompt handed to a coding agent: the problem, the evidence, the paths it may write, what it
  must not change, the acceptance criteria and the exact validation command. It says "You may change only these paths"
  because a scope that is not stated is not a scope.
- **`--markdown`** renders it for a person, for a pull request description or an issue.
- **`--json`** emits the stored document, which is what an agent reads over the Model Context Protocol.

There is no "assign to agent" button anywhere. Orchescope does not dispatch work; it produces a task and, afterwards, an
honest answer about the outcome.

## Validating

Validation is a comparison plus a rescan, never an assertion:

1. Rerun the scenarios the goal names, with the same seed and the same fault plan the baseline used.
2. Compare the candidate runs against the baseline runs.
3. Rescan, so `finding_resolved` can be judged on a fresh graph.
4. Judge each criterion, reporting satisfied, refused or undecided with a reason.

The comparison applies the rules that keep it honest: sample sizes travel with every metric, a difference the samples do
not support is `indeterminate`, and a latency improvement alongside a success decline is `mixed` or `regressed`, never
`improved`. One exception is deliberate: for an event that must never happen, such as a duplicated side effect, crossing
zero is decided by presence rather than by distribution. An effect that happened once and now happens never is a
categorical change, not a statistical claim, and that is why such a criterion is stated even where the recorded baseline
is too small for a direction while a latency or a success rate criterion is not.

A criterion about a metric is decided only from a comparison whose two sides describe the same work. One that ran
different scenarios, variants or fault plans measured something else, says so in its limitations, and leaves the
criterion undecided rather than reporting the conditions as the change.

## Where to look

- `packages/goals/src/create.ts`: finding to goal.
- `packages/goals/src/render.ts`: the three renderings.
- `packages/goals/src/validate-plan.ts`: judging criteria.
- `packages/comparison/src/compare.ts`: directions, verdicts and the incident metric rule.
- `tests/e2e/improvement-loop.test.ts`: the whole loop, end to end, through the real command line.
- [../protocols/goal-schema.md](../protocols/goal-schema.md): the document, field by field.
