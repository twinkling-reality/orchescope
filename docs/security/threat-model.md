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
- **HTTP requests to the report server**, including requests from pages the user did not open.

Trusted: the arguments the user typed, and the configuration file in the repository, which is treated as the user's own
statement of intent.

## Threats and controls

### Reading or writing outside the audited repository

*A path in a manifest, a scenario, an export destination or a report request escapes the repository root.*

- Every repository relative path is resolved and normalised before it is compared against the root, so
  `<root>/../../etc/passwd` is refused rather than opened. A textual prefix check would accept it.
- An absolute path is refused where a relative one is expected.
- The report server serves a fixed allow list of four asset names, resolved inside one directory; it never maps a request
  path onto the filesystem.
- Traversal does not follow symbolic links unless configuration enables it, and a broken link is recorded as skipped.

### Executing something the user did not ask for

*A repository, a scenario or a manifest causes an unexpected process to run.*

- Discovery never executes repository code. It parses it.
- A process is started only by `trace`, `test`, `benchmark` and `chaos`, and only through `spawn` or `execFile` with an
  argument array. There is no shell anywhere, so shell metacharacters have no meaning.
- The executable is checked against `policy.allowedCommands` first, by exact match or by basename. A path that merely ends
  with an allowed name does not pass.
- `policy.allowProcessSpawn` gates the whole capability, and setting it to `false` keeps an audit entirely static.

### Reaching the network

*An audit sends something somewhere.*

- Orchescope makes no outbound request of its own. There is no telemetry, no update check and no registry call.
- Nothing in Orchescope calls a model, so no part of an audited repository reaches a provider. That is a decision with
  a record, not an omission: [ADR 0002](../architecture/adr/0002-deterministic-analysis.md).
- The chaos fault proxy refuses to forward anywhere other than loopback unless outbound network access has been granted.
- Every listening socket binds to `127.0.0.1` on a port chosen by the operating system and closes when the command ends.

### A secret leaving the process

*A credential appears in a report, a log line, an error message or an export.*

- Every string that leaves the process passes through the redactor: reports, exports, logs, errors, progress lines and
  stored evidence.
- Patterns are anchored on documented credential prefixes where one exists, and fall back to high entropy shapes where none
  does. Values whose name looks sensitive are masked whatever their shape.
- Redaction preserves the kind and the length of what it removed, so a reader can see that something was there.
- **This is a reduction, not a proof.** A secret in a shape nothing recognises can survive it, which is why an export is
  something to review before sharing.

### Another page reading the report

*A page the user did not open reads the analysis from the loopback server.*

Five controls, each covering a case the others do not:

1. **Host allow list**, so a name that resolves to loopback but is not this server is refused with `421`. This is what stops
   DNS rebinding.
2. **Origin check**, so a request declaring a foreign origin is refused.
3. **Fetch metadata.** A cross site read of an API route is refused; a cross site navigation to a document is allowed,
   because refusing it would break an ordinary link without protecting anything.
4. **Capability token.** The port is guessable by scanning; a 32 byte token is not. It arrives once in the URL and is
   exchanged for an HttpOnly, SameSite=Strict cookie so it stops appearing in the address bar. Comparison is constant time.
5. **Route and method allow lists**, with a bounded request body and a `413` rather than unbounded buffering.

The served page carries a content security policy with no `unsafe-inline` and no remote origin, `nosniff`, `no-referrer`,
`no-store`, and same origin resource and opener policies. Both type faces are served as files from that same origin, so the
policy keeps `font-src 'self'`.

The standalone HTML export pins its own inline script and style by hash and carries `font-src data:` rather than `'self'`.
Opened from a disk it is a `file:` page, where `'self'` resolves to nothing it can fetch, so the faces it inlines would be
unreachable. The widening is bounded: `default-src 'none'` still blocks every network destination, `data:` is allowed for
fonts and for nothing else, and a font is not executable. Evidence: `packages/report/test/standalone.test.ts`.

### Untrusted content executing in the report

*A component name, a prompt excerpt, a span attribute or a model response contains markup.*

- The browser workspace renders text as text. There is no `innerHTML` path and no dynamic inline style.
- The bundle is delivered in a JSON island whose closing sequences are escaped.
- The content security policy has no `unsafe-inline`, so an injected script has nothing to run in even if one arrived.

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
- **A local user with your account can read the store.** Owner only permissions, not encryption.
- **An audit that reports nothing is not a certification.** It means the rules that had evidence did not fire.

## Reporting

See [../../SECURITY.md](../../SECURITY.md).
