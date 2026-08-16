# Threat model

Orchescope reads source, prompts, configuration and traces, and it executes the system it is pointed at. This document
states what is worth protecting, where the boundaries are, what each control does, and what remains true after every
control is applied.

## Assets

| Asset | Why it matters |
| --- | --- |
| Repository source and prompts | The most sensitive material a team has, and the input to every audit |
| Traces and side effect records | Contain request content, model output, targets of external effects |
| Credentials in the environment | Present because the audited system needs them; Orchescope never needs them |
| The store and its artifacts | An aggregate of all of the above, in one directory |
| Reports and exports | The form in which any of the above leaves the machine |
| The audited system's external effects | Payments, notifications, writes: real actions with real consequences |
| The user's machine and account | The context every command runs in |

## Trust boundaries

Everything below is untrusted input, whatever it claims about itself:

- **Repository content.** Source, configuration, `.orchescope/manifest.yaml`, `scenarios/*.yaml`. A repository can be
  hostile, and a manifest or a scenario can name a command.
- **Trace data.** Span names, attributes and events, whether from a local run or an imported file.
- **Model output**, in a trace or a target result: an agent system's own model writes into the spans Orchescope reads.
- **Tool output** recorded in a target's result file.
- **Anything imported**: a graph, a report bundle, a trace file.
- **HTTP requests to the trace receiver.** It listens on loopback while `trace` wraps a command and while `receive` holds
  a window open, and it authenticates nothing, so a request arriving there is a claim about a run rather than a fact
  about one.

Trusted: the arguments the user typed, and the configuration file in the repository, which is treated as the user's own
statement of intent.

## Threats and controls

### Reading or writing outside the audited repository

*A path in a manifest, a scenario or an export destination escapes the repository root.*

- Every repository relative path is resolved and normalised before it is compared against the root, so
  `<root>/../../etc/passwd` is refused rather than opened. A textual prefix check would accept it.
- An absolute path is refused where a relative one is expected.
- The trace receiver answers one route and never maps a request path onto the filesystem, so there is no path in a
  request for a traversal to be built out of.
- Traversal does not follow symbolic links unless configuration enables it, and a broken link is recorded as skipped.

### Executing something the user did not ask for

*A repository, a scenario or a manifest causes an unexpected process to run.*

- Discovery never executes repository code. It parses it.
- A process is started only by `trace`, `test`, `benchmark` and `chaos`, and only through `spawn` or `execFile` with an
  argument array. There is no shell anywhere, so shell metacharacters have no meaning.
- The executable is checked against `policy.allowedCommands` first, by exact match or by basename. A path that merely ends
  with an allowed name does not pass.
- **That list is a guardrail against a typo, not a security control, and it is trivially bypassable.** Only `argv[0]` is
  checked, and the default list contains runners: `orchescope trace -- seorak --once` is refused while
  `orchescope trace -- npx seorak --once` runs. `npm run`, `uv run`, `deno run` and `node -e` walk past it the same way.
  Checking further would not close it either, because a runner's argument can be any command. Treat the list as a way to
  keep an obvious mistake from starting a process, and treat the argv you pass as something you have read.
- `policy.allowProcessSpawn` gates the whole capability, and setting it to `false` keeps an audit entirely static. That is
  the only setting here that bounds anything, and it bounds whether a process starts rather than what it may then do.
- **Once a process starts, it runs with your full ambient privileges.** Orchescope adds environment variables and, for a
  Node target, loads its own instrumentation; it takes nothing away. The traced command can write anywhere you can write,
  reach any network you can reach, and spend anything your credentials can spend. Nothing in this tool sandboxes it.

### Reaching the network

*An audit sends something somewhere.*

- Orchescope makes no outbound request of its own. There is no telemetry, no update check and no registry call.
- Nothing in Orchescope calls a model, so no part of an audited repository reaches a provider. That is a decision with
  a record, not an omission: [ADR 0002](../architecture/adr/0002-deterministic-analysis.md).
- The chaos fault proxy binds `127.0.0.1`, refuses to start at all without an explicit upstream so it can never become an
  open proxy, and refuses a non loopback upstream unless outbound network access has been granted. The scenario runner
  does not start it: a fault asking for proxy delivery is handed to the target for cooperative application instead, and
  the run records that as a limitation rather than performing the substitution quietly.
- So one socket is bound by an ordinary command, the OTLP trace receiver, on the address `runtime.receiverHost` names,
  which accepts only `127.0.0.1` or `::1`. The port defaults to one the operating system chooses, and the socket closes
  when the command ends.

### A secret leaving the process

*A credential appears in a report, a log line, an error message or an export.*

- Every string that leaves the process passes through the redactor: reports, exports, logs, errors, progress lines and
  stored evidence.
- Patterns are anchored on documented credential prefixes where one exists, and fall back to high entropy shapes where none
  does. Values whose name looks sensitive are masked whatever their shape.
- Redaction preserves the kind and the length of what it removed, so a reader can see that something was there.
- **This is a reduction, not a proof.** A secret in a shape nothing recognises can survive it, which is why an export is
  something to review before sharing.

### Something else reaching the trace receiver

*A process, or a page the user did not open, sends spans to the loopback receiver.*

The threat here is a write rather than a read. The receiver serves nothing: `POST /v1/traces` is the only request it
answers and an OTLP `ExportTraceServiceResponse` is the only thing it returns, so there is no analysis behind it to be
read and no session to be stolen. What reaching it buys is spans in the run being collected, and the controls bound that.

1. **Loopback only**, on the address `runtime.receiverHost` names. The setting accepts `127.0.0.1` and `::1` and nothing
   else, so there is no configuration that quietly listens on a network.
2. **One route and one method.** Anything other than `POST` is `405`, any path other than `/v1/traces` is `404`.
3. **A bounded body.** `runtime.maxRequestBytes` is checked against the declared content length before a byte is read
   and against the running total while it is read, so a lying content length does not get past it. Over the ceiling is
   `413` rather than unbounded buffering, and a body that does not decompress is refused rather than retried.
4. **A bounded run.** `runtime.maxSpansPerRun` caps how many spans one run holds; a span past the ceiling is dropped and
   counted, so the bundle states how many it did not keep rather than implying it saw everything.
   `maxSpanAttributeBytes` truncates an attribute value rather than discarding the span it belongs to.
5. **A bounded window.** The socket lives for the wrapped command under `trace`, and for the `--for` window under
   `receive`, itself capped by `policy.maxRunDurationMs`. An unbounded window would be a daemon, and this is not one.

A span whose trace or span identifier is the wrong length is rejected rather than stored, because an identifier that
cannot be joined to anything is not evidence, and the count comes back to the exporter as OTLP `partialSuccess` rather
than being swallowed.

Two content types are accepted, protobuf and JSON, because those are what the OpenTelemetry SDKs export; anything else is
`415`, and a body that does not decode is `400`, which the specification forbids a client from retrying. The receiver
makes no outbound request of its own and follows no redirect. Header and keep alive timeouts bound a connection that
opens and says nothing. Evidence: `tests/e2e/receive.test.ts`, which posts to the real receiver over the real transport,
holds that the window closes itself, and holds that a window nothing exported to says so rather than reporting an empty
run as a result.

### Untrusted content steering the terminal

*A component name, a prompt excerpt, a span attribute or a model response contains an escape sequence.*

The terminal is the only human surface, so this is where hostile text arrives rendered rather than quoted.

- Every string that reaches a cell of the audit document or the progress line passes `sanitiseCell`, which removes the
  C0 and C1 controls and the delete character before the string is measured. A name carrying a cursor sequence therefore
  cannot move the cursor, repaint a row already written or end one early.
- A leading combining mark is dropped with them, because a mark with nothing before it attaches to whatever the terminal
  drew last, which is a neighbouring cell rather than its own.
- Width is measured in display columns rather than code units, so a cut never leaves half a wide glyph and a name never
  overruns the grid it was given.
- Evidence: `apps/cli/test/display-width.test.ts`.

The bound is the grid. A Mermaid label has its quotes and its line breaks taken out and nothing else; a JSON, SARIF or
markdown document is text rather than cells. None of them is stripped of escape sequences, because none of them is
written to a cursor, and every one of them still passes the redactor.

The reader of the JSON document is a coding agent rather than a terminal, and the content is the same. It is still
untrusted there: a component name is a string a repository chose, and nothing about passing through Orchescope makes it
an instruction.

### A misleading result

*A finding, a metric or a verdict says more than the evidence supports.*

This is a security concern because a false assurance is acted on:

- A finding with no evidence is dropped, and the drop is recorded.
- Severity is capped by basis and confidence, and the cap is shown.
- Sample sizes travel with every metric; quantiles below a threshold are withheld rather than computed from too little.
- A latency improvement alongside a success decline is never reported as an improvement.
- A criterion that could not be judged is reported as undecided, never as passed.
- Coverage states what was not inspected, every time.

### Cost and runaway execution

*An audit spends money or time without a bound.*

- `policy.maxCostUsd`, `maxRunDurationMs`, `maxConcurrentRuns` and `maxTotalRuns` are ceilings enforced before work starts
  and while it runs. The cost ceiling defaults to zero.
- Concurrency is bounded, queues are bounded, retries are bounded, and output capture is bounded.
- A deadline is created once per command and checked cooperatively, so cancellation is clean.

### Corrupt or hostile stored state

*A store from another version, or a tampered artifact.*

- The schema version lives in `PRAGMA user_version`; a database written by a newer build is refused rather than read.
- Artifacts are content addressed, and a digest that is not a digest is refused, which is also what closes a traversal
  through the artifact path.
- Every document read back is validated against its schema before use.
- Tables are `STRICT`, so a type mismatch fails at write time rather than surprising a reader later.
- Files and directories are created with owner only permissions.

## What remains true after every control

- **Orchescope executes your system.** The bound is the configured policy, not a sandbox. A process it starts can do
  whatever it was written to do.
- **Chaos causes real failures**, including ones that produce duplicated external effects. That is the measurement.
- **Prompt injection scenarios feed hostile text to your agents on purpose.** If the agent acts on it, that is the finding.
- **Redaction is a pattern set.** It cannot prove the absence of a secret.
- **The trace receiver authenticates nothing.** Anything on the machine that can reach the port while the window is open
  can push spans into the run being collected, and a run built from spans it did not observe is a measurement of
  nothing. The bound is that the window is short, the port is loopback, and the receiver hands nothing back.
- **A local user with your account can read the store.** Owner only permissions, not encryption.
- **An audit that reports nothing is not a certification.** It means the rules that had evidence did not fire.

## Reporting

See [../../SECURITY.md](../../SECURITY.md).
