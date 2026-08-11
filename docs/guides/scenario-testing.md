# Scenario testing

A scenario makes a run repeatable. That is the whole point: a measurement you cannot repeat cannot be compared, and a
comparison is what turns a change into an answer.

## Write one

Scenarios live in `scenarios/` in your repository. The smallest useful one:

```yaml
schemaVersion: 1
id: happy-path
name: One customer question, answered
target:
  command: ['node', 'src/main.js']
  resultSource: result_file
  timeoutMs: 30000
input:
  prompt: Where is my order 1234?
evaluators:
  - kind: exit_code
    equals: 0
budgets:
  maxDurationMs: 30000
  maxTokens: 200000
faults: []
seed: 1
repetitions: 3
requiredPermissions:
  - process:spawn
  - network:loopback
```

Then:

```
orchescope test --scenario happy-path
```

Every field is described in [../protocols/scenario-schema.md](../protocols/scenario-schema.md).

## What your target has to do

Nothing, to start with. A target that ignores every environment variable still runs, reports one variant and no faults.

To get more out of it, read what Orchescope hands over:

| Variable | Do this with it |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Point your existing exporter at it. This is where spans go |
| `ORCHESCOPE_RESULT_FILE` | Write your own result document here: success, output, effects, interventions |
| `ORCHESCOPE_SEED` | Seed every random decision from it. Without this, repetitions are not comparable |
| `ORCHESCOPE_INPUT` | The scenario's input, as JSON |
| `ORCHESCOPE_AGENTS`, `_WORKERS`, `_CONCURRENCY` | Honour these to make your system benchmarkable |
| `ORCHESCOPE_FAULT_PLAN` | Apply these faults deterministically to make it chaos testable |

The result file is worth writing. It is how a target reports things no generic convention can express: whether the task
actually succeeded by your definition, which effects happened with which idempotency keys, and whether a human had to step
in. Where the result file and the spans disagree about an effect, the larger count wins, so reporting an effect in both
places is safe.

## Evaluators decide pass or fail

Eight deterministic kinds, listed in the schema document. Two habits keep them useful:

**Assert the property, not the wording.** `output_contains_all: ['Refund approved']` breaks when someone rewrites a
message. `metric_threshold: { metric: errors, comparator: eq, value: 0 }` does not.

**Assert what must not happen.** `no_duplicate_effects` and a `prohibitedEffects` entry with `maxCount: 1` are the
assertions that catch the class of defect this tool exists to find.

An evaluator that cannot run is reported as skipped with a reason. It is never reported as passed.

## Repetitions and what they buy

```yaml
seed: 1
repetitions: 5
```

Every repetition is stored separately with its own metrics and evaluator outcomes. The aggregate reports the raw durations,
the quantiles it could compute, and the quantiles it withheld with the sample count each needed:

```
support-desk: passed over 5 repetition(s)
  duration: p50 2240ms, min 2180ms, max 2390ms, 5 sample(s)
  p90 withheld: it needs at least 10 samples
  reliability: 5 of 5 succeeded, pass^2 1.00, pass^3 1.00
```

`pass^k` is the probability that k independent runs all succeed, which is what a caller of an agent actually experiences.
A scenario that passes four times in five has a `pass^3` of about half.

Withholding a quantile rather than computing it from four samples is deliberate. A p95 from five runs is not a p95.

## Comparing runs

```
orchescope test --scenario happy-path
# make a change
orchescope test --scenario happy-path
orchescope compare <baseline-run-id> <candidate-run-id>
```

The comparison reports each metric with both sample sizes and a direction, and it will not call something an improvement
that the samples do not support:

```
mixed: 1 metric improved and 1 metric regressed
  metric              baseline     candidate    change       samples
  + durationMs        2240.00      1180.00      -47.3%       5/5
  x errors            0.00         2.00         +200.0%      5/5
```

Three rules make the verdict trustworthy: direction is per metric so lower is not always better, a latency win with a
success loss is never `improved`, and a difference from too few samples is `indeterminate` with the reason stated.

One deliberate exception: for an event that must never happen, such as a duplicated side effect, crossing zero is decided by
presence rather than by distribution. An effect that happened once and now happens never is a categorical change, not a
statistical claim.

## Running the scenarios a goal names

```
orchescope test --goal OSC-GOAL-0001
```

Runs the scenarios in the goal's validation plan, with the seed and repetitions the goal recorded, which is what makes a
validation reproduce the baseline conditions.

## Where scenarios come from

They are files in your repository, which means they are reviewed like code and they travel with the change they measure.
`orchescope audit` discovers and stores them, so `orchescope test --scenario <id>` works by identifier without a path.

Treat a scenario file as untrusted input to Orchescope: it names a command, and that command is checked against
`policy.allowedCommands` before anything runs. Review a scenario that arrived in a pull request before you run it.
