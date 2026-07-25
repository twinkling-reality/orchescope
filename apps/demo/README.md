# @orchescope/demo

A deterministic support desk agent system. It exists to be audited: Orchescope maps it, runs scenarios
against it, injects faults into it and reports on it, so this application contains a small set of
deliberate weaknesses next to a small set of deliberate strengths, and it honours every protocol a target
can honour.

It has **zero runtime dependencies**, uses only Node builtins, runs **offline**, holds no credential and
calls no model provider. A local scripted provider answers from a fixed table keyed by the prompt digest
and the seed.

## Running it

```sh
node apps/demo/src/main.ts                      # one request, seed 1, three agents, star topology
pnpm demo                                       # the same thing from the workspace root
node apps/demo/src/main.ts --seed 7 --agents 5  # flags override the environment
node --test apps/demo/test/demo.test.ts         # the test suite
```

With no environment variables at all the run succeeds, prints a short summary to stdout and exits 0. A run
that cannot recover from an injected fault also exits 0 and reports `success: false` in its result: the
outcome of the task and the health of the process are different questions.

## Protocols it honours

### Environment

| Variable | Default | Effect |
| --- | --- | --- |
| `ORCHESCOPE_OTLP_ENDPOINT` | unset | Base URL of an OTLP receiver. Spans are POSTed to `${endpoint}/v1/traces`. Unset means spans are dropped silently. |
| `ORCHESCOPE_RESULT_FILE` | unset | Path the TargetResult JSON is written to. |
| `ORCHESCOPE_SEED` | `1` | Seeds every decision, identifier, token count and queue wait. |
| `ORCHESCOPE_AGENTS` | `3` | Total number of agents, 1 to 8. Honoured honestly: see the topology rules below. |
| `ORCHESCOPE_WORKERS` | `2` | Worker agents and refund queue pool size, 1 to 4. |
| `ORCHESCOPE_CONCURRENCY` | `1` | Simultaneous customer requests in one run, 1 to 50. Each request is its own trace. |
| `ORCHESCOPE_TOPOLOGY` | `star` | `star` fans out to the delegates in parallel, `chain` nests them one inside the next. |
| `ORCHESCOPE_MODEL` | `demo-small` | Primary model. The configured fallback is `demo-large`. |
| `ORCHESCOPE_INPUT` | a fixed request about order 1234 | The customer request. |
| `ORCHESCOPE_PROMPT_VERSION` | `v3` | Recorded in the planner prompt. |
| `ORCHESCOPE_FAULT_PLAN` | unset | A FaultPlan JSON document, applied cooperatively. |

Anything else Orchescope passes is ignored rather than rejected. The same flags are accepted on the command
line (`--seed`, `--agents`, `--workers`, `--concurrency`, `--topology`, `--model`, `--input`,
`--prompt-version`) and take precedence over the environment.

### Result file

`ORCHESCOPE_RESULT_FILE` receives:

```json
{
  "success": true,
  "output": "...",
  "effects": [{ "kind": "refund", "target": "payments/order-1234", "outcome": "succeeded" }],
  "userInterventions": 0,
  "policyViolations": 0,
  "loopIterations": 2
}
```

`effects` lists every side effect that was actually performed, including duplicates produced by a retry, in
request order. An effect that carries no `idempotencyKey` did not send one.

### Traces

`src/telemetry.ts` is a small OTLP/HTTP JSON exporter: batched spans, `content-type: application/json`,
identifiers as lowercase hex, span kind and status code as integers, nanosecond timestamps as decimal
strings, and one resource attribute, `service.name=orchescope-demo`. Identifiers and timestamps are derived
from the seed and a per trace counter, never from the wall clock or a random source, so the exported trace
of a run is a function of its inputs.

What each span carries:

- agent: `invoke_agent <name>`, kind 1, `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name`,
  `gen_ai.conversation.id`.
- model: `chat <model>`, kind 3, `gen_ai.operation.name=chat`, `gen_ai.provider.name=orchescope-demo`,
  `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`. Token counts are
  computed from the prompt and the reply that were really used.
- tool: `execute_tool <tool>`, kind 1, `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`,
  `gen_ai.tool.type=function`.
- retrieval: `retrieval policy-store` with `gen_ai.operation.name=retrieval` and
  `gen_ai.data_source.id=policy-store`, nested inside the `search_policies` tool span.
- memory: `search_memory conversation-memory` and `update_memory conversation-memory`.
- queue: `queue_wait refunds` with `orchescope.queue.wait_ms`. No operation attribute: the span name prefix
  carries it.
- approval: `approval issue_refund` with `orchescope.approval.granted`.
- every span: `code.file.path`, `code.function.name` and `code.line.number`, where the line is the line the
  span is opened on.
- root span: `orchescope.task.success`, `orchescope.task.output`, `orchescope.policy_violation`,
  `orchescope.user_intervention` and `vcs.repository.name=orchescope`.
- retried operations: `orchescope.retry.attempt`, one based, on every attempt span.
- injected faults: `orchescope.fault.injected=<kind>` on the span that suffered the fault.
- side effects: span events named `orchescope.side_effect` with `orchescope.side_effect.kind`,
  `.target`, `.outcome` and, when one was sent, `.idempotency_key`.

### Fault plan

`ORCHESCOPE_FAULT_PLAN` is read as a FaultPlan. An unreadable plan means no faults, unknown fault kinds are
ignored and a probability outside `[0, 1]` is clamped: a plan arrives from another process and is treated as
untrusted input. Decisions are a pure function of the plan seed, the fault kind, the target, the attempt
number and how many matching operations the fault has already seen, so each match draws independently and a
probability of 0.5 affects about half of them. `attempts`, `probability` and `maxApplications` are all
respected. Supported kinds:

`model_timeout`, `model_rate_limited`, `model_server_error`, `model_malformed_structured_output`,
`tool_timeout`, `tool_exception`, `tool_malformed_result`, `retrieval_empty`, `worker_unavailable`,
`queue_delay`, `prompt_injection_in_content`.

A fault target is a tool name (`check_inventory`), a model name (`demo-small`), a worker name
(`account-worker`), `policy-store`, `refunds`, or `*`. An injected delay is slept for real, capped at 250ms
so a plan cannot stall an offline run, and the full requested value is still reported on the span.

An injected fault never produces an unhandled rejection. A request that cannot recover ends with
`success: false`, its root span reports the failure and the run still writes its result file.

```sh
ORCHESCOPE_FAULT_PLAN='{"id":"fp_00000000000000ab","seed":11,"faults":[
  {"kind":"tool_timeout","target":"check_inventory","delivery":"cooperative","probability":1}]}' \
  node apps/demo/src/main.ts
```

## What the system does

One request, end to end: recall the conversation, plan with the model, look up the account, check
inventory, retrieve the relevant policies, hand off to the workers, queue the refund, pass the approval
boundary, issue the refund, notify the customer, write the audit log, answer.

Topology rules, so that `ORCHESCOPE_AGENTS` is honoured rather than reported:

- 1 agent: the orchestrator does the analysis itself and hands off to nobody.
- up to `ORCHESCOPE_WORKERS` workers are delegated to directly, from
  `account-worker`, `inventory-worker`, `shipping-worker`, `billing-worker`.
- any agents beyond the orchestrator and its workers become `regional-coordinator-N`, a second tier that
  invokes a share of the workers and reconciles their findings. Every agent in the count appears in the
  trace and performs work.

## The intentional issues

| # | Issue | Where |
| --- | --- | --- |
| 1 | Two independent tool calls run sequentially | `src/agents/orchestrator.ts:81` (comment), calls at `:83` and `:87` |
| 2 | Unsafe retry: `issue_refund` retried up to three times with no idempotency key, so a failed attempt plus a retry produces two refunds | `src/tools/refund.ts:15` (comment), retry loop at `:143`, effect recorded at `:96`, `:101`, `:105` |
| 3 | Contrast case: `send_notification` retries with an idempotency key and the provider deduplicates | `src/tools/notification.ts:9`, key at `:31`, acceptance at `:58` and `:78` |
| 4 | `escalate_to_human` is registered and unreachable in the default path | `src/tools/escalation.ts:8`, registered at `src/agents/definitions.ts:155`, gate at `src/agents/settlement.ts:36` |
| 5 | A model fallback that a healthy run never exercises | `src/model.ts:18`, selection at `:187` |
| 6 | An `audit-log` component that appears at runtime and in no agent definition | `src/audit.ts:9`, datastore write at `:22` and `:56` |
| 7 | The full conversation is passed to every worker although each reads one field | `src/agents/workers.ts:60`, prompt built at `:63` |
| 8 | Good architecture: (a) the refund cannot be reached without the approval boundary, (b) every model call has an explicit deadline and a bounded retry with backoff | (a) `src/tools/refund.ts:11` and `:49`, (b) `src/model.ts:15` |
| 9 | A `check_inventory` timeout ends the whole task instead of degrading | `src/agents/orchestrator.ts:84` |
| 10 | A tool whose name is assembled at runtime, so it runs on every request and is declared nowhere | `src/tools/metering.ts:7`, called at `src/agents/orchestrator.ts:193` |

Issue 10 is what makes the fourth reconciliation delta visible. `metering_record_usage` appears in every trace and in no
source file or manifest, because its name is joined from parts. A team reading their own repository would not find it.

Issue 2 needs a first attempt that fails. Two things cause it:

- a `tool_timeout` or `tool_exception` fault on `issue_refund`,
- or a seed whose gateway rejects the first attempt. For the default request about order 1234, of the first
  twenty seeds those are **7, 11 and 16**. The default seed 1 succeeds on the first attempt, so the baseline
  run performs exactly one refund.

Issue 4 is reachable on purpose, and never by accident: a refund above the automatic approval limit of
5000, an account with more than five open tickets, or a request that mentions legal action.

```sh
ORCHESCOPE_INPUT='Refund order 9001 immediately' node apps/demo/src/main.ts   # 7400 USD, escalates
ORCHESCOPE_SEED=7 node apps/demo/src/main.ts                                  # duplicate refund
```

Retrieved policy text is untrusted. Under `prompt_injection_in_content` an instruction is appended to the
top document, the orchestrator treats the documents as reference material, never turns retrieved text into
a tool call, and the run records `orchescope.policy_violation=false` with `policyViolations: 0`.

## Determinism

Same seed, same everything: same span identifiers, same virtual timestamps, same token counts, same side
effects, same answer. Verify it:

```sh
ORCHESCOPE_SEED=5 ORCHESCOPE_RESULT_FILE=/tmp/a.json node apps/demo/src/main.ts > /dev/null
ORCHESCOPE_SEED=5 ORCHESCOPE_RESULT_FILE=/tmp/b.json node apps/demo/src/main.ts > /dev/null
diff /tmp/a.json /tmp/b.json && echo identical
```

The queue wait is derived from the seed and the queue depth rather than measured, because a measured wait
would make two runs of the same seed differ. With `ORCHESCOPE_CONCURRENCY` above one, per request traces stay
deterministic; the `maxApplications` budget of a fault is consumed in the order requests reach the decision
point.

## Layout

```
src/main.ts                  environment and argv, concurrent requests, result file, summary
src/telemetry.ts             OTLP/HTTP JSON exporter with deterministic identifiers and clock
src/random.ts                the seeded mixers everything else derives from
src/faults.ts                fault plan parsing and deterministic decisions
src/failures.ts              failure kinds, deadlines, bounded sleeps
src/context.ts               the shapes shared by agents and tools, and the side effect recorder
src/model.ts                 scripted provider with deadline, bounded retry and fallback
src/memory.ts                per conversation memory with traced read and write
src/queue.ts                 bounded refund queue and its worker pool
src/audit.ts                 the runtime only audit log effect
src/agents/definitions.ts    the declared agents, tools, handoffs and models
src/agents/orchestrator.ts   the request from sentence to answer
src/agents/settlement.ts     approval decision, queueing and the refund outcome
src/agents/workers.ts        the worker tier and the coordinator tier
src/tools/tool-span.ts       the shared tool span and tool fault lookup
src/tools/account.ts         lookup_account, read only
src/tools/inventory.ts       check_inventory, read only
src/tools/policies.ts        search_policies over the in repo policy documents
src/tools/refund.ts          issue_refund, the approval boundary and the unsafe retry
src/tools/notification.ts    send_notification, idempotent
src/tools/escalation.ts      escalate_to_human, the approval boundary out to a person
test/demo.test.ts            the run, determinism, faults and idempotency asserted end to end
```
