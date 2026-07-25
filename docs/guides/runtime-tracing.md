# Runtime tracing

Getting runtime evidence in, from a system that already emits OpenTelemetry and from one that does not.

## The simplest case

If your system exports OTLP over HTTP and honours `OTEL_EXPORTER_OTLP_ENDPOINT`, there is nothing to change:

```
orchescope trace -- node src/main.js
```

Orchescope starts a receiver on `127.0.0.1` on a port the operating system chooses, exports its address to the child as both
`ORCHESCOPE_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_ENDPOINT`, runs the command, waits for the exporter to drain, and stores
the spans as a run.

```
orchescope trace --label "nightly" --timeout 120000 -- npm run agent
```

The command must be on `policy.allowedCommands`. That list is what bounds what Orchescope will execute, so a command not on
it is refused with the setting named rather than run.

## What the audit does with the spans

```
orchescope audit
```

The audit reconciles every stored run against the static graph and reports the four deltas. `--runs <count>` bounds how many
recent runs are considered; `--runs 0` skips reconciliation.

## What Orchescope reads from a span

**To identify the operation**, either dialect:

| Attribute | Meaning |
| --- | --- |
| `gen_ai.operation.name` | `chat`, `execute_tool`, `invoke_agent`, `embeddings`, `create_agent`, `invoke_workflow`, `plan`, `retrieval`, memory operations |
| `gen_ai.provider.name` | The provider |
| `gen_ai.request.model`, `gen_ai.response.model` | The model |
| `gen_ai.usage.input_tokens`, `output_tokens` | Token counts |
| `gen_ai.tool.name`, `gen_ai.agent.name` | Component names |
| `openinference.span.kind` | The OpenInference equivalent |

Both the current and the previous spellings of the renamed generative AI fields are read, because the conventions are still
in development upstream and exporters lag.

**To join back to source**, which is the strongest match rule:

| Attribute | Meaning |
| --- | --- |
| `code.file.path`, `code.line.number` | Where the operation is defined |
| `vcs.repository.ref.revision` | Which revision ran |

**To say what a convention has no field for**, Orchescope's own namespace:

| Attribute | Meaning |
| --- | --- |
| `orchescope.component` | An explicit component name, overriding inference |
| `orchescope.retry.attempt` | This span is attempt N of the same operation |
| `orchescope.task.success` | Whether the task succeeded |
| `orchescope.user_intervention` | A human had to step in |
| `orchescope.policy_violation` | A policy was violated |
| `orchescope.approval.granted` | An approval boundary was passed |
| `orchescope.queue.wait_ms` | Time spent waiting in a queue |

**Side effects**, as a span event named `orchescope.side_effect` with these attributes:

| Attribute | Meaning |
| --- | --- |
| `orchescope.side_effect.kind` | `refund`, `notification`, `write`, whatever your domain calls it |
| `orchescope.side_effect.target` | What was affected, such as `payments/order-1234` |
| `orchescope.side_effect.idempotency_key` | The key, when there is one. Its absence is the finding |
| `orchescope.side_effect.outcome` | `succeeded`, `failed` or `unknown` |

`unknown` is the important one. A gateway call that timed out may or may not have committed, and that is exactly the case
duplication analysis exists for. Recording it as `unknown` rather than guessing is what makes the analysis correct.

## Emitting a side effect event

Any OpenTelemetry SDK. This is the whole change:

```js
span.addEvent('orchescope.side_effect', {
  'orchescope.side_effect.kind': 'refund',
  'orchescope.side_effect.target': `payments/order-${orderId}`,
  'orchescope.side_effect.idempotency_key': idempotencyKey,
  'orchescope.side_effect.outcome': 'unknown',
});
```

Set the outcome to `unknown` before the call returns and to `succeeded` after, so a timeout leaves `unknown` behind rather
than nothing.

## A system that emits nothing yet

Two paths, and the first is usually enough.

**Instrument the boundaries only.** You do not need full tracing to get value. One span per model call, one per tool call,
with `gen_ai.operation.name` and the tool or model name, produces a usable topology. Add `code.file.path` if you want the
strongest join.

**Declare it instead.** `.orchescope/manifest.yaml` gives the static side the names, and `runtimeName` maps a source name to
whatever your telemetry calls the same thing. Reconciliation then matches on the declared name rather than needing a code
location.

## Importing spans

For a system whose runs happen elsewhere:

```
orchescope trace --import traces.ndjson
```

OTLP JSON and newline delimited spans are both accepted. Identifiers may be base64, which the protobuf JSON mapping
specifies, or lowercase hex, which several exporters emit.

## Limits, and what happens at them

| Limit | Default | At the limit |
| --- | --- | --- |
| `runtime.maxSpansPerRun` | 50000 | Further spans are dropped, and the count is reported |
| `runtime.maxSpanAttributeBytes` | 4096 | The attribute is truncated |
| `runtime.maxRequestBytes` | 8 MB | The request is refused with `413` |
| `runtime.exportDrainMs` | 400 | How long to wait after the process exits for the exporter to flush |

Every one of these is reported when it bites. A trace that lost spans silently would produce a delta that looks like a
finding.

## Spans Orchescope could not understand

A span with no recognised operation attribute and no recognised name prefix is counted as unattributed with a reason:

- `no_operation`: nothing in the span said what it was.
- `unsupported_dialect`: something did, and this build does not read that dialect.

The counts appear in the report. This matters when a run produces a thin topology: the reason is usually that the spans carry
a convention Orchescope does not read, not that the system did little.

## Verifying it worked

```
orchescope trace -- node src/main.js
```

The summary states how many spans arrived from how many services and the run identifier. Zero spans with a successful exit
means the exporter did not reach the receiver: check that your SDK honours the endpoint variable, that it uses OTLP over
HTTP rather than gRPC, and that it flushed before the process exited.
