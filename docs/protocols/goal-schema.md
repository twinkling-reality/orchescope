# Goal schema

Machine readable: [`schemas/goal.v1.json`](../../schemas/goal.v1.json). Generated from `packages/schema/src/goal.ts`.

Current version: **1**. The compatibility rules are the same as for
[the system graph](system-graph-schema.md#compatibility-rules).

A goal is the unit of work handed to a person or a coding agent. It is bounded on purpose: it says what to change, what may
be touched, what must not change, and the command that decides the outcome.

## A real goal

`orchescope goal show OSC-GOAL-0001 --json` against the demonstration system, abridged only where a field repeats:

```json
{
  "schemaVersion": 1,
  "id": "OSC-GOAL-0001",
  "findingId": "OSC-REL-0001",
  "title": "Attach an idempotency key derived from the request, or stop retrying this operation.",
  "status": "ready",
  "problemStatement": "The side effect refund|payments/order-1234 was recorded 2 times within a single run, and 18 times across 9 observed run(s), and at least one occurrence came from retry attempt 2. No idempotency key was present, so nothing downstream can collapse the duplicates.\n\nImpact: A duplicated external effect is visible to the user or to a third party. For a payment, a notification or a provisioning call, the second one is a real incident.",
  "evidence": ["ev_1a2b3c4d5e6f7a8b"],
  "evidenceSummary": [
    { "label": "duplicate_occurrences", "value": "2 count over 9 sample(s)", "basis": "observed" },
    { "label": "span evidence", "value": "18 record(s)", "basis": "observed" }
  ],
  "affectedComponents": ["tool:issue_refund"],
  "sourceLocations": [{ "file": "src/tools/refund.ts", "startLine": 24 }],
  "scope": {
    "allowedWritePaths": [".orchescope/manifest.yaml", "src/tools/refund.ts"],
    "prohibitedChanges": [
      "changing an acceptance criterion or a validation command in this goal",
      "editing a stored baseline run, benchmark or comparison",
      "weakening an evaluator or removing an assertion to make a scenario pass",
      "disabling redaction, a policy setting or a permission check"
    ],
    "invariants": [
      "the observable behaviour of every path not named in this goal stays the same",
      "no external effect becomes possible that was not possible before"
    ],
    "requiredApprovals": ["live_execution"]
  },
  "risk": "medium",
  "acceptanceCriteria": [
    { "id": "AC-01", "statement": "task success does not decline against the baseline",
      "check": { "kind": "metric_not_worse", "metric": "successRate", "tolerance": 0 } },
    { "id": "AC-02", "statement": "no duplicate side effect appears in any validation run",
      "check": { "kind": "metric_not_worse", "metric": "duplicateSideEffects", "tolerance": 0 } },
    { "id": "AC-03", "statement": "scenario support-desk passes",
      "check": { "kind": "scenario_passes", "scenarioId": "support-desk" } },
    { "id": "AC-04", "statement": "finding OSC-REL-0001 no longer fires on a rescan",
      "check": { "kind": "finding_resolved", "findingId": "OSC-REL-0001" } }
  ],
  "validation": {
    "scenarioIds": ["support-desk"],
    "baselineRunIds": ["run_57103f56def013db", "run_bdf6b359aff9cbae", "run_9f6f3984eb244d47"],
    "commands": [
      { "purpose": "rescan the repository so the static side of the finding is re-evaluated",
        "command": ["orchescope", "audit", "--json"] },
      { "purpose": "rerun the scenario the goal names, with the same seed",
        "command": ["orchescope", "test", "--scenario", "support-desk", "--json"] }
    ],
    "repetitions": 3,
    "requiresExecution": true
  },
  "rollback": "Revert the change to src/tools/refund.ts and rerun the scenario to confirm the baseline behaviour returns.",
  "validationResults": [],
  "createdAt": "2026-07-25T04:12:44.000Z",
  "updatedAt": "2026-07-25T04:12:44.000Z",
  "metadata": {}
}
```

## Fields

| Field | Notes |
| --- | --- |
| `id` | `OSC-GOAL-NNNN`, sequential per project, derived from the stored identifiers |
| `findingId` | The finding it came from |
| `status` | `draft`, `ready`, `in_progress`, `validated`, `rejected`, `abandoned` |
| `problemStatement` | What is wrong and why it matters, quoting the measured numbers |
| `evidence` | Evidence identifiers, at least one |
| `evidenceSummary` | The salient values copied with their basis, so the goal is readable after a rescan replaces the finding |
| `affectedComponents` | At least one component identifier |
| `scope.allowedWritePaths` | At least one repository relative path. The implementer may write nowhere else |
| `scope.prohibitedChanges` | Named explicitly, including the ways a change could make validation pass without fixing anything |
| `scope.invariants` | Behaviour that must keep holding, expressed for a reviewer |
| `scope.requiredApprovals` | `human_review`, `live_execution`, `cost_budget` |
| `risk` | `low`, `medium`, `high` |
| `acceptanceCriteria` | At least one `AC-NN`, each with a checkable statement and a typed check |
| `validation` | The scenarios, the baseline runs, the exact commands, the repetitions, and whether execution is required |
| `rollback` | How to undo the change if validation fails |
| `validationResults` | Every comparison that judged this goal, newest last |

## The prohibited changes are the interesting part

Three of the four entries exist to close the ways a change can appear to succeed without succeeding: editing the goal's own
criteria, editing a stored baseline, and weakening an evaluator. A validation that the implementer can redefine is not a
validation. The fourth closes the case where a change passes by turning a control off.

## Check kinds

| Kind | Fields | Decided by |
| --- | --- | --- |
| `metric_improvement` | `metric`, `comparator`, `relativeThreshold` or `absoluteThreshold` | a comparison |
| `metric_not_worse` | `metric`, `tolerance` | a comparison, using its resolved direction |
| `scenario_passes` | `scenarioId` | a scenario result |
| `finding_resolved` | `findingId` | a rescan |
| `command_succeeds` | `command` | never here: the implementer runs it |
| `manual_review` | `statement` | never here: a person records it |

The last two are always reported as undecided, with the reason. A goal that contains only those cannot reach `validated`,
which is correct: nothing measured it.

## Validation outcomes

`orchescope goal validate <id> --comparison <id>` returns one outcome per criterion:

```json
{
  "criterion": "AC-02",
  "statement": "no duplicate side effect appears in any validation run",
  "satisfied": true,
  "decided": true,
  "detail": "duplicateSideEffects moved from 1 to 0 and was judged improved (decided by presence rather than by distribution: the event no longer occurs)"
}
```

`satisfied` and `decided` are separate on purpose. A criterion that could not be judged is `decided: false`, never
`satisfied: false`, because "we could not tell" and "it did not work" call for different responses.

## Rendering

- `orchescope goal show <id> --prompt` renders the implementer prompt, including the sentence "You may change only these
  paths" followed by the write scope.
- `--markdown` renders it for a pull request or an issue.
- `--json` emits this document.
- Over the Model Context Protocol, `create_improvement_goal` returns both the document and the prompt.

Nothing dispatches the work. Orchescope produces the task and, afterwards, an honest answer about the outcome.
