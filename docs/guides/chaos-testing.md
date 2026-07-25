# Chaos testing

One fault at a time, applied deterministically, measured for what it did to the whole task. The question is not "does it
crash" but "does it degrade, and does anything reach the outside world twice".

**Nothing here is safe.** Chaos causes real failures on purpose, including failures that produce duplicated external
effects. Run it against a system whose side effects you are prepared to have happen.

## Declare the faults

Faults live in the scenario, so the fault set travels with the system it describes:

```yaml
faults:
  - kind: tool_timeout
    target: issue_refund
    delivery: cooperative
    probability: 1
    attempts: [1]
    maxApplications: 1
    delayMs: 10
  - kind: model_rate_limited
    target: demo-small
    delivery: cooperative
    probability: 1
    attempts: [1]
    maxApplications: 1
```

Then:

```
orchescope chaos --scenario support-desk-faults
```

## One plan per fault

`orchescope test` applies every fault the scenario declares, because a scenario is a complete description of a run.
`orchescope chaos` does something different: it runs the scenario once per fault, each with a plan containing only that
fault.

That is what makes an outcome attributable. If eight faults were injected together and the task failed, you know the system
fails under eight simultaneous faults, which nobody needed to be told. One fault per run tells you which one.

## Reading the output

Real output from the demonstration system:

```
Chaos chaos_bdbc66ab4c45e327 local_deterministic
  + tool_exception on issue_refund: completed true, recovered true, duplicates 0, cost x3.55
  ! tool_timeout on issue_refund: completed true, recovered true, duplicates 1, cost x3.55
  x tool_timeout on check_inventory: completed false, recovered false, duplicates 0, cost x0.53
  + model_rate_limited on demo-small: completed true, recovered true, duplicates 0, cost x4.02
  + retrieval_empty on policy-store: completed true, recovered true, duplicates 0, cost x2.87
  + worker_unavailable on inventory-worker: completed true, recovered true, duplicates 0, cost x2.18
  + prompt_injection_in_content on policy-store: completed true, recovered true, duplicates 0, cost x3.62
```

Three markers, and the middle one is the one to look at:

- **`+`** the task completed and nothing was duplicated. The fault was absorbed.
- **`!`** the task completed **and an effect happened twice**. This is worse than a clean failure: the caller saw success
  while the payment gateway saw two refunds.
- **`x`** the task did not complete. A single dependency failure ended it.

Two findings are visible in that output. `tool_timeout on issue_refund` duplicated a refund, because the retry has no
idempotency key and a timeout cannot distinguish "did not happen" from "happened, response lost". `tool_timeout on
check_inventory` collapsed the task, because there is no degraded path that answers without inventory.

Cost amplification is the ratio against the healthy baseline. `x3.55` means the failure path cost three and a half times the
successful one, which is what retries and re-planning do. The `x0.53` on the collapsed run is lower because the task stopped
early: a cheap failure is not a good outcome.

## What is measured

| Measurement | Meaning |
| --- | --- |
| `taskCompleted` | Did the task finish at all |
| `recovered` | Did it recover from the fault rather than propagating it |
| `duplicateSideEffects` | Did any logical effect happen more than once in one run |
| `retryAmplification` | Retries under the fault, against the baseline |
| `costAmplification` | Tokens under the fault, against the baseline |
| `userInterventions` | Did a human have to step in |
| `loopIterations` | Did it loop, and did the loop converge |
| `degradedGracefully` | Completed with a reduced answer rather than failing or duplicating |
| `policyViolations` | Did it do something the policy forbids |

A fault that could not be applied is reported in `notApplied` with the reason, never silently skipped. A chaos report whose
faults all failed to apply looks like a resilient system otherwise.

## The fault set

Bounded, and specific to agent systems rather than generic infrastructure faults:

**Model:** `model_timeout`, `model_rate_limited`, `model_server_error`, `model_malformed_structured_output`,
`model_stream_interrupted`.

**Tool:** `tool_timeout`, `tool_exception`, `tool_malformed_result`, `tool_stale_result`.

**Retrieval and memory:** `retrieval_empty`, `retrieval_slow`, `context_corruption`.

**Topology:** `worker_unavailable`, `queue_delay`.

**Effects and identity:** `side_effect_partial_success`, `duplicate_response`, `auth_expired`.

**Content:** `prompt_injection_in_content`, which places hostile text in retrieved content on purpose. If your agent acts on
it, that is the finding. Nothing about this makes prompt injection a solved problem.

## Delivery

**`cooperative`** hands the plan to the target through `ORCHESCOPE_FAULT_PLAN` and lets it apply the fault deterministically
from the seed. This is the default and the only mode that can express a fault inside the target's own logic, such as a tool
raising an exception on its first attempt.

**`proxy`** injects at a loopback proxy for faults that can be expressed as an HTTP response: a rate limit, a server error, a
timeout expressed as never answering. The proxy refuses to forward anywhere other than loopback unless outbound network
access has been granted.

## Environments

```
orchescope chaos --scenario support-desk-faults --environment local_deterministic
```

- **`local_deterministic`** is the default and the only one enabled out of the box. Faults are simulated from a seed and
  nothing reaches a real dependency.
- **`declared_test`** and **`live`** must be added to `policy.allowedChaosEnvironments` first. Every cost and duration
  ceiling still applies, and the report records which environment produced each outcome.

A finding from a chaos run carries `basis: "simulated"`, which caps its severity at `high`. The claim is about behaviour under
an injected fault, not about production, and the finding text says so.

## Reproducing one outcome

```
orchescope chaos --scenario support-desk-faults --seed 7
```

Same seed, same plan, same outcome. That is what lets a fix be verified: rerun the fault that duplicated the refund and
require the duplicate count to reach zero, which is exactly what the goal's acceptance criteria do.
