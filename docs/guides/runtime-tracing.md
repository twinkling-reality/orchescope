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

## What happens when your system emits nothing

Most do not. The variables in the next section are inert unless something in the target process already
loads an OpenTelemetry SDK, and essentially no Node project does by default.

So for a Node target, Orchescope loads its own instrumentation into the process, with
`NODE_OPTIONS=--import`. It records every outbound request the target makes and names it by what it did:

| The request | What the run records |
| --- | --- |
| A call to a published model endpoint | a model, with the provider, the model name and the token counts |
| A Model Context Protocol `tools/call`, over HTTP or over standard input | the tool, by the name reconciliation joins tools on |
| Any other write | an outside effect, with the idempotency key when one was sent |
| Any other read | the service it reached |

Recognising a model endpoint by host is what makes a system that calls a provider through plain `fetch`
rather than through its package visible at all. Reading the tool name out of the protocol message is what
lets a tool your repository declares and a tool your run executes become the same component, which is the
join the whole audit is built on.

A local MCP server is spawned by its client and spoken to over standard input, so nothing about that call
passes `fetch`. For it, and only for it, Orchescope patches one method of the client package it finds in
your own dependencies. The patch checks the shape before it touches anything, and every traced run reports
what it patched and what it declined to patch, under `instrumentation.patches` in `--json`: a client this
build does not recognise has to be something you can see, not a trace that quietly holds no tool calls.

A model call and a protocol message are not recorded as outside effects. Both are POSTs, and counting them
would report two chat completions in one run as one effect that happened twice.

It is deliberately small, and deliberately restrained:

- it does nothing unless the process is the subject of a traced run, which matters because `NODE_OPTIONS`
  is inherited by every child process the target starts;
- it stands down entirely if the target already runs OpenTelemetry, because that instrumentation knows more
  than this one does and running both would report every call twice;
- it captures no prompt or completion content, and no query string;
- it never writes to your program's output, registers no signal handler, and swallows its own failures. A
  program must not fail on account of being watched.

Turn it off with `runtime.autoInstrument: false` in `.orchescope/config.json`. Every traced run says on
standard output whether it was loaded.

**It reaches Node processes only.** `NODE_OPTIONS` means nothing to `python3`, `uvicorn`, `docker` or
`wrangler`, and a command that spawns a child in another runtime has the same boundary: the child is where
the spans are. For those, point the target's own exporter at the receiver URL that `orchescope trace`
prints. The zero span message says which case you are in.

## What Orchescope sets, and what your process has to do with it

These are set for the target process, and nothing else is required of it:

| Variable | Value |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the receiver, on `127.0.0.1` on a port the operating system chose |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | the same address with `/v1/traces` |
| `OTEL_TRACES_EXPORTER` | `otlp` |
| `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | `none`, because only traces are read |
| `OTEL_SERVICE_NAME` | the project name, unless the environment already sets one |
| `OTEL_BSP_SCHEDULE_DELAY` | `200`, so a short run still flushes |
| `ORCHESCOPE_OTLP_ENDPOINT`, `ORCHESCOPE_RUN_ID`, `ORCHESCOPE_RESULT_FILE` | for a target that wants to report a result without tracing |

Your process needs an OpenTelemetry SDK loaded, exporting over **HTTP rather than gRPC**. The two ecosystems Orchescope
analyses load one like this, and both read the variables above without any Orchescope specific code:

```
# Node, with the OpenTelemetry auto instrumentation packages installed in your project
orchescope trace -- node --import @opentelemetry/auto-instrumentations-node/register src/main.js

# Python, with the opentelemetry distro and its instrumentation installed
orchescope trace -- opentelemetry-instrument python -m app
```

Those two loaders and their packages are OpenTelemetry's, not Orchescope's, and their names are their own. What Orchescope
guarantees is the receiver and the variables in the table.

When a run collects nothing, the command line says so and names the three causes worth checking: no SDK was loaded, the SDK
exported over gRPC, or the process exited before flushing. `OTEL_BSP_SCHEDULE_DELAY` and `runtime.exportDrainMs` are what
make the last case unlikely, but a process that calls `process.exit` in a callback can still beat the flush.

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

## A system that is already running

`trace` wraps a command, which is no help for a development server, a worker, or anything you did not start. For those,
listen instead:

```
orchescope receive --for 10m
```

That prints the endpoint the moment it is listening. Point the running process at it and restart that process:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:53142 OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

The window ends when the duration elapses, or when you interrupt it, and whatever arrived is stored as a run. Nothing is
lost by stopping early. `--for` takes `90s`, `10m` or `1h`; a bare number means seconds, and the window is capped by
`policy.maxRunDurationMs`.

The receiver binds to loopback only. A process on another machine reaches it through a tunnel you open deliberately,
which is a decision for you rather than a default that quietly listens on a network.

This is receiving, not fetching. There is no query interface to a collector, because OTLP is a push protocol and every
backend that stores spans has its own API, so fetching would mean choosing one vendor and calling it the integration.
If your spans already go to a collector, add a second OTLP exporter pointing at the endpoint above for as long as the
window lasts.

## Importing spans

For spans you already have on disk:

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
