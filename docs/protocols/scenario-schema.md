# Scenario schema

Machine readable: [`schemas/scenario.v1.json`](../../schemas/scenario.v1.json). Generated from
`packages/schema/src/scenario.ts`. Results: [`schemas/scenario-result.v1.json`](../../schemas/scenario-result.v1.json).

Current version: **1**. A scenario file declares `schemaVersion: 1`, and a build that understands version 1 refuses a
higher one rather than reading it partially.

A scenario is a repeatable run. It is the unit a benchmark varies, a chaos suite injects faults into, and a goal reruns to
decide whether a change worked.

## A real scenario

`apps/demo/scenarios/support-desk.yaml`, unedited:

```yaml
schemaVersion: 1
id: support-desk
name: Support desk refund and inventory request
description: >
  The default path through the demonstration system.

target:
  command: ['node', 'src/main.ts']
  resultSource: result_file
  timeoutMs: 30000
  stopSignal: SIGTERM

input:
  prompt: Where is my order 1234, and can I get a refund if it is late?

variant:
  agents: 3
  workers: 2
  concurrency: 1
  topology: star
  model:
    provider: orchescope-demo
    model: demo-small

expect:
  taskSuccess: true
  requiredEffects:
    - kind: refund
      target: payments/order-1234
      minCount: 1
  prohibitedEffects:
    - kind: refund
      maxCount: 1

evaluators:
  - kind: exit_code
    equals: 0
  - kind: span_observed
    operation: execute_tool
    componentName: lookup_account
    minCount: 1
  - kind: no_duplicate_effects
  - kind: metric_threshold
    metric: errors
    comparator: eq
    value: 0

budgets:
  maxDurationMs: 30000
  maxTokens: 200000
  maxModelCalls: 200
  maxRetries: 20

faults: []

seed: 1
repetitions: 3

requiredPermissions:
  - process:spawn
  - network:loopback

tags: [support, refund, baseline]
```

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase, hyphenated, two to sixty four characters. Referenced by every command |
| `name` | yes | One line for a person |
| `target.command` | yes | Argv, executed without a shell. The executable must be on `policy.allowedCommands` |
| `target.resultSource` | yes | Where the target's own result comes from: `result_file`, `stdout_json` or `none` |
| `target.timeoutMs` | yes | Ceiling for one repetition. Exceeding it marks the run `timeout` |
| `target.stopSignal` | no | `SIGINT` or `SIGTERM` before escalating to `SIGKILL` |
| `target.cwd`, `target.env` | no | Working directory inside the repository, extra environment entries |
| `input` | no | `prompt` and structured `data`, handed over as environment values |
| `variant` | no | The dimensions a benchmark can vary |
| `expect` | no | Assertions about outcome and effects |
| `evaluators` | yes | May be empty. Each is deterministic unless it is `model_judge` |
| `budgets` | yes | Ceilings for one run, enforced while it runs |
| `faults` | yes | May be empty. `orchescope test` applies them all; `orchescope chaos` applies one at a time |
| `seed` | no | Handed to the target as `ORCHESCOPE_SEED`. Omitting it means results are not reproducible, and the report says so |
| `repetitions` | no | Defaults to one. Statistics need more |
| `requiredPermissions` | yes | Checked before anything executes |

## The environment contract

Orchescope does not link to your system. It passes what a run needs as environment variables, so a target honours a variant
without depending on Orchescope:

| Variable | Meaning |
| --- | --- |
| `ORCHESCOPE_OTLP_ENDPOINT` | The loopback receiver. Also exported as `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `ORCHESCOPE_RESULT_FILE` | Where to write the target's own result document |
| `ORCHESCOPE_RUN_ID`, `ORCHESCOPE_SCENARIO_ID` | Identifiers for correlation |
| `ORCHESCOPE_SEED` | The seed, for reproducibility |
| `ORCHESCOPE_AGENTS`, `_WORKERS`, `_CONCURRENCY`, `_TOPOLOGY` | The variant dimensions |
| `ORCHESCOPE_MODEL_PROVIDER`, `ORCHESCOPE_MODEL` | The variant's model |
| `ORCHESCOPE_PROMPT_VERSION`, `ORCHESCOPE_TOOL_CONFIG` | Variant selectors the target interprets |
| `ORCHESCOPE_INPUT`, `ORCHESCOPE_INITIAL_STATE` | The input and starting state, as JSON |
| `ORCHESCOPE_FAULT_PLAN` | The fault plan, as JSON, for cooperative injection |

A target that ignores all of them still runs; it simply reports one variant and no faults.

## Evaluators

Nine kinds. Eight are deterministic:

| Kind | Checks |
| --- | --- |
| `exit_code` | The process exit code equals a value |
| `output_contains_all` | Every string appears in the captured output |
| `output_contains_none` | No string appears |
| `json_pointer_equals` | A pointer into the target's result document equals a value |
| `effect_recorded` | An effect of a kind, and optionally a target, happened at least a number of times |
| `no_duplicate_effects` | No logical effect happened twice within one run |
| `span_observed` | A span of an operation, optionally naming a component, appeared at least a number of times |
| `metric_threshold` | A run metric satisfies a comparator against a value |
| `model_judge` | A language model judges the output |

`model_judge` requires model based analysis to be enabled and is refused otherwise. When it runs, its verdict carries the
`model_interpreted` basis and never decides a scenario alone.

An evaluator that cannot run is reported as skipped with a reason, never as passed.

## Faults

A fault names a kind from the bounded set, a target, a delivery mode, a probability, which attempts it applies to, and a
ceiling on applications. `cooperative` delivery hands the plan to the target through `ORCHESCOPE_FAULT_PLAN` and lets it
apply the fault deterministically from the seed; `proxy` delivery injects at the loopback proxy for faults that can be
expressed as a response. See [../guides/chaos-testing.md](../guides/chaos-testing.md).

## Results

A scenario result carries every repetition separately, with its own metrics, evaluator outcomes and side effects, plus an
aggregate that includes the raw durations, the withheld quantiles with the sample count each needed, reliability including
`pass^k`, and a list of limitations. A result never reports a quantile it could not compute from enough samples, and never
claims statistical significance.
