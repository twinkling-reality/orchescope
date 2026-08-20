# Runtime observation

Orchescope learns what a system does by ingesting the OpenTelemetry spans it already emits. There is no agent in your
process, no gateway in front of your providers, and no proprietary wire format.

```
your process ──OTLP/HTTP──► loopback receiver ──► normalized spans ──► runtime topology
                                                                            │
                                            static graph ──────────────► reconciliation
                                                                            │
                                                                    four deltas + findings
```

## Getting spans in

Three ways, in order of how often they are used:

**Wrap the process.** `orchescope trace -- <command>` starts a receiver on loopback, exports its address to the child as
both `ORCHESCOPE_OTLP_ENDPOINT` and the standard `OTEL_EXPORTER_OTLP_ENDPOINT`, runs the command, waits for the exporter to
drain, and stores the result as a run. The receiver exists for the duration of the command and binds to `127.0.0.1` on a
port the operating system chooses.

**Run a scenario.** `orchescope test --scenario <id>` does the same thing with a declared target, a seed, a variant and an
optional fault plan, and evaluates the result.

**Import.** A file of OTLP JSON or newline delimited spans can be imported without running anything, for a system whose
runs happen elsewhere.

The receiver accepts OTLP over HTTP in both encodings. Protobuf is the default for most SDKs and is decoded by a
hand written wire reader, so no protobuf toolchain is needed. JSON is accepted in both identifier encodings that senders
use in practice: base64, which the protobuf JSON mapping specifies, and lowercase hex, which several exporters emit.

Limits are enforced while decoding, not after: spans per run, bytes per attribute, bytes per request. Anything dropped is
counted and reported.

## Attribute dialects

Two are understood:

- **OpenTelemetry generative AI conventions**, `gen_ai.*`: `gen_ai.operation.name` as the discriminator, plus provider,
  request and response model, token counts, tool name and agent name. These conventions are in development status
  upstream, so both the current and the previous spellings of the fields that were renamed are read.
- **OpenInference**, used by several tracing libraries: `openinference.span.kind` and its associated attributes.

A span with neither is not discarded; it is counted as unattributed with a reason (`no_operation` when nothing said what
it was, `unsupported_dialect` when something did but this build does not read it, `no_name` when it said what kind of
thing it is and did not name it), and the count appears in the report.

Two attribute families are load bearing beyond identification. `code.*` gives a span a source location, which is the
strongest join back to the static graph. `vcs.*` gives it a revision, which is how a run can be tied to the state of the
repository it ran from.

Orchescope also reads its own namespace, `orchescope.*`, which a target can emit to say things a generic convention has no
field for: that a span was a retry attempt, that a side effect happened with a kind, a target, an outcome and an
idempotency key, that a task succeeded, that a human intervened, that a policy was violated.

## From spans to topology

Spans are assembled into a forest by parent identifier, then folded into components and relations:

- **Self time** is a span's duration minus the time its children occupied, so latency is attributed to the component that
  actually spent it rather than to every ancestor waiting on it.
- **Parallelism** is detected by sibling overlap in wall clock, which is what distinguishes "these two tools ran together"
  from "these two tools ran one after the other".
- **Retries** are recognised from an explicit attempt attribute, or from a repeated operation on the same component after a
  failure. A retried operation is one component attempted twice, never two components.
- **Structure is not a component.** An instrumentation opens spans for its own shape as well as for the system it is
  watching: the OpenAI Agents SDK's instrumentor opens one for the trace and one per iteration of the agent loop, and
  the AI SDK opens one around every model call and tool call an agent makes. A span carrying an OpenInference `AGENT`
  or `CHAIN` kind and no attribute naming the thing has said that something is nested here and nothing about what, so
  no component is minted from its label and it is counted as unattributed with reason `no_name`. Only those two kinds
  are asked, because they are the ones whose name this build reads out of an attribute. A relation is then drawn to the
  nearest enclosing component, so a span that is no component does not break the chain between an agent and what it
  called.
- **Handoffs** are recognised where a framework performs one by calling a tool, which is what the OpenAI Agents SDK does and
  what its instrumentor faithfully records. A tool span that names no tool, whose `input.value` and `output.value` are both
  names the same run reported as agents, is a transfer of control between those two agents. The span name is corroboration
  and never the test: a repository may call a tool anything, and a span that does name a tool is a call to that tool
  whatever its arguments say. A transfer becomes a relation and never a component, and its duration is attributed to that
  relation, which is the only thing it can honestly be attributed to.
- **Side effects** are collected from span events and from the target's own result file, and counted as the larger of the
  two sources rather than their sum, so a carefully instrumented target that reports an effect in both places is not
  accused of duplicating it.
- **An attempt that failed is not an occurrence.** It changed nothing outside the system. An attempt whose outcome is
  unknown is counted, because a timeout that may have committed is exactly the case duplication analysis exists for.

## The join

The static graph and the runtime topology are matched by an explicit sequence of rules, strongest first:

1. **`code_location`.** The span carries `code.file.path` and `code.line.number`, and a component was discovered there.
   This is the only rule that cannot be fooled by a name.
2. **`runtime_name`.** A manifest declared `runtimeName` for a component, and the span reports that name. This is how a
   team resolves a mismatch between what their code calls something and what their telemetry calls it.
3. **`kind_and_name`.** The kind and the normalised name agree.
4. **A bare name fallback.** The runtime qualifies a name with a namespace the source does not, as in
   `orchescope-demo/demo-small` against `demo-small`. The last path segment is compared.

A name that matches two candidates is recorded as **ambiguous** and matched to neither, because a wrong join produces a
wrong finding that looks well supported. Every match produces an evidence record naming the rule that made it.

## The four deltas

The join yields the output that nothing else produces:

| Delta | What it means |
| --- | --- |
| **Declared and never exercised** | The repository configures it and no ingested run reached it. A tool nothing calls, a fallback nothing takes. |
| **Exercised and never declared** | A run used a model, service or tool that appears nowhere in what was inspected. Either the scan missed it or the system reaches somewhere nobody wrote down. |
| **Contradicted declarations** | A declaration and the behaviour disagree: a retry declared idempotent that repeated an effect, a timeout declared and exceeded. |
| **Duplicated side effects** | The same logical operation happened more than once inside one run, attributed to the operation that produced it. |

Coverage is reported with them: how many declared components and relations exist, how many of those declared parts were
exercised, and the rate, along with the revision the static side was read at and the runs the runtime side came from.
Undeclared observations are counted only under exercised-and-never-declared, not in the coverage denominator. A delta
without those anchors is not reproducible.

Duplicate counting deserves one note, because it is easy to get wrong in a way that looks alarming. The count that means
duplication is the maximum within a single run; the total across runs is reported separately as history. Repeating an
effect in ten separate runs is expected. Repeating it twice in one run is the defect.

## Where to look

- `packages/runtime/src/receiver.ts`: the loopback receiver.
- `packages/traces/src/otlp.ts`: both wire encodings.
- `packages/traces/src/attributes.ts`: the dialects and the attribute names.
- `packages/traces/src/topology.ts`: self time, parallelism, retries, side effects.
- `packages/graph/src/reconcile.ts`: the match rules.
- `packages/graph/src/delta.ts`: the four deltas.
