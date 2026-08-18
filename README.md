# Orchescope

Map, test, and improve agent systems.

Orchescope reads an agent system's source, ingests what it does when it runs, and reports the difference between the two.
It runs on your machine, writes only inside the repository you point it at, and sends nothing anywhere.

```
orchescope audit
```

## What it does

- **Maps the system.** Discovers agents, models, providers, prompts, tools, MCP servers, retrieval, memory, queues,
  databases, external services, approval boundaries, retries and fallbacks from source and configuration, and records
  where each one was found.
- **Reconciles what is declared against what ran.** Ingests OpenTelemetry spans from your own runs and reports four
  deltas: declared and never exercised, exercised and never declared, declarations contradicted by behaviour, and the
  same external effect performed more than once inside a single run.
- **Reports findings with evidence.** Every finding names the components it is about, cites the spans or source locations
  it came from, states whether it was observed, discovered, inferred, simulated or estimated, and says what it would take
  to verify a fix. Good design is reported too, not only risk.
- **Runs the system under scenarios and faults.** Deterministic, seeded, local by default. Measures completion, recovery,
  duplicated effects, retry and cost amplification, and whether a human had to intervene.
- **Benchmarks one dimension at a time.** Agent count, worker count or concurrency, with sample sizes and variance
  attached, and a refusal to call a latency win an improvement when task success fell.
- **Turns a finding into a bounded goal.** A goal states the problem, the evidence, the files a change may touch, the
  acceptance criteria and the exact command that decides whether the change worked.
- **Talks to your coding agent.** The same operations are available over the Model Context Protocol and as stable JSON on
  the command line.

## What it does not do

- It does not proxy your traffic, host a gateway, or sit between your agents and their providers.
- It does not send your code, prompts, traces or findings anywhere. There is no account and no telemetry.
- It does not evaluate answer quality. It measures behaviour, cost, reliability and structure, not whether an answer was
  good.
- It does not interpret your repository with a model. Analysis is deterministic: every claim comes from a rule over
  evidence, and a second run reproduces it.
- It does not claim your system is safe. It reports what it found and what it could not inspect.

## Install

Node.js 24 or newer is required. There is no compiler step and no native build on install.

```
npm install -g orchescope
```

Or without installing anything:

```
npx orchescope audit
```

The same archive is attached to every release with its sha256 beside it, and `pnpm package` reproduces it from this
repository, so you can check that what you installed is what this source builds:

```
pnpm install
pnpm package                       # builds the bundle, packs, installs and audits with it
npm install -g release/orchescope-0.4.0.tgz
```

`pnpm package` also installs the tarball into a temporary prefix and audits a project with it, so a failure there means the
artifact is broken rather than your machine.

Maintainers: the unit that gets published is `release/stage`, not `apps/cli`. See [docs/guides/release.md](docs/guides/release.md).

## Quickstart

From the root of a repository that contains an agent system:

```
orchescope audit
```

That discovers the system, reconciles it against any runs already stored, and prints a terminal document: what was
found, where you stand in the improvement loop, and what to run next. Agents use the same facts over `--json` or MCP.

To get runtime evidence, run your system under `trace`. Your process reports spans to a loopback receiver that exists
only for the duration of the run:

```
orchescope trace -- node src/main.js
orchescope audit
```

## Core commands

| Command | What it does |
| --- | --- |
| `orchescope audit` | Discover the system, reconcile it against stored runs, report findings |
| `orchescope trace -- <command>` | Run a command, collect its OpenTelemetry spans, store them as a run |
| `orchescope receive --for 10m` | Listen for spans from a system that is already running, store them as a run |
| `orchescope test --scenario <id>` | Run a scenario and evaluate it |
| `orchescope benchmark --scenario <id> --agents 1,2,4` | Vary one dimension and compare the variants |
| `orchescope chaos --scenario <id>` | Inject the faults a scenario declares and report what each one did |
| `orchescope compare <baseline> <candidate>` | Compare two runs, scans or revisions |
| `orchescope goal create <finding-id>` | Turn a finding into a bounded improvement goal |
| `orchescope goal validate <goal-id>` | Judge a goal against measured evidence |
| `orchescope export --format <json\|mermaid\|sarif>` | Export the report |
| `orchescope mcp serve` | Speak the Model Context Protocol on stdio (primary agent surface) |
| `orchescope init` | Create `.orchescope` with a configuration file listing every default |
| `orchescope init --manifest` | Also write a manifest template for a system no adapter can read from source |
| `orchescope doctor` | Check that this machine can run every command this build offers |

Every command accepts `--json` and then writes exactly one JSON document to standard output, including on failure. The
document has the same four keys whatever happened, so a caller never special cases an outcome:

```json
{ "ok": true, "command": "audit", "version": "0.4.0", "data": { "…": "…" } }
{ "ok": false, "command": "audit", "version": "0.4.0", "data": null, "error": { "code": "…", "category": "…", "message": "…" } }
```

Exit codes are part of the interface: `0` success, `1` findings at or above a `--fail-on` threshold, `2` a caller mistake,
`3` refused by policy, `4` the audited system failed, `5` the environment is missing something, `130` interrupted.

`orchescope trace` is the exception, and it is the one a pipeline cares about: it exits with the status the traced
command exited with, the way `timeout` and `env` do, so a step that already reads statuses keeps reading them. The
codes above still apply where Orchescope itself is what failed, which is every path that ends before a target runs.
`--json` reports the target's own status as `data.exitCode` for a caller that needs the two kept apart.

A traced command keeps standard output to itself. The run report is a diagnostic and goes to standard error beside the
privileges notice, so `orchescope trace -- generate > out.json` writes the file the target wrote. Under `--json` the
document owns standard output and the target's output moves to standard error rather than being dropped.

## Architecture

Layers depend inward only, and the boundary is enforced in continuous integration by a dependency rule set rather than
by convention:

```
schema      versioned data contracts, no internal dependencies
domain      identities, invariants, statistics; may only reach node:crypto
core        graph, discovery, traces, findings, scenarios, benchmark, chaos, comparison, goals, report
adapters    source analysis, persistence, process runtime, redaction, observability
assembly    workspace, use cases
edges       command line, agent interface, demonstration system
```

The unified system graph is the centre. Component identity is `(kind, namespace, local name)` rather than a line number,
so an identifier survives an edit and a finding can be compared across scans. Every persisted document carries a schema
version, and every schema is emitted as JSON Schema under `schemas/`.

See [docs/architecture/overview.md](docs/architecture/overview.md) and
[docs/architecture/module-boundaries.md](docs/architecture/module-boundaries.md).

## Privacy

Everything stays on your machine.

- No account, no network calls, no telemetry, no upload, and nothing calls a model. Analysis is deterministic; the
  reason that is a decision rather than an omission is in
  [ADR 0002](docs/architecture/adr/0002-deterministic-analysis.md).
- The only server this tool starts is the receiver `trace` and `receive` use to collect your spans. It binds to
  loopback and lives for the duration of the run.
- State lives in `.orchescope/state/` inside the repository you audit. Every command that creates that directory writes
  a local `.gitignore` beside it, so state is excluded from the first run onward. Configuration is meant to be committed;
  state is not, and `init` says so when a rule in your repository would keep the configuration out too.
- Exported reports are redacted with a pattern set before they leave the process. Redaction reduces exposure; it is not a
  guarantee, and the report says so.

See [docs/security/data-handling.md](docs/security/data-handling.md).

## Security warning

Orchescope executes the system you point it at. `trace`, `test`, `benchmark` and `chaos` start your processes with your
environment. Chaos injects faults into a running system, and prompt injection scenarios feed hostile text to your agents
on purpose.

Nothing here makes those operations safe, and Orchescope is not a sandbox. A command it starts runs with your full
ambient privileges: it writes the files it always writes, binds the ports it always binds, and reaches the network it
always reaches. `execution.allowedCommands` checks only `argv[0]`, so it stops a typo and not a decision, and
`allowFilesystemWrites` and `allowOutboundNetwork` constrain Orchescope's own behaviour rather than your system's.

What it does bound: process execution is refused entirely unless `execution.allowProcessSpawn` is on, live chaos
environments are refused unless you enable them, cost and duration and concurrency have ceilings, and a retry around an
operation with no established idempotency is reported rather than assumed safe. Run it against a system whose side
effects you are prepared to have happen, in an environment where that is acceptable.

See [SECURITY.md](SECURITY.md) and [docs/security/threat-model.md](docs/security/threat-model.md).

## Ecosystem support

Only what is tested is claimed. Each of these has an adapter exercised by tests in this repository:

| Ecosystem | Discovered from |
| --- | --- |
| OpenAI Agents SDK (JavaScript, TypeScript and Python) | `new Agent({...})` and `Agent(name=...)`, handoffs, tools, `@function_tool` with `name_override` and `needs_approval`, MCP servers including a command nested in `params`, `maxTurns` |
| LangGraph (JavaScript, TypeScript and Python) | `StateGraph`, `addNode("name", fn)` and `add_node(fn)`, edges, conditional edges, and `create_react_agent(model, tools=[...])` with the model reference it names |
| CrewAI (Python) | `Agent(...)`, `Crew(...)`, `config/agents.yaml` including the model its `llm` field names |
| Pydantic AI (Python) | `Agent('provider:model', ...)`, `@agent.tool` and `@agent.tool_plain`, `retries`, `requires_approval`, `output_type` |
| Vercel AI SDK (JavaScript and TypeScript) | `generateText`, `tool(...)`, `maxSteps` |
| Model SDKs | OpenAI, Anthropic and compatible clients, including base URL overrides |
| Model Context Protocol | `.mcp.json`, `.vscode/mcp.json`, and `FastMCP` including `from mcp.server import` and the `@mcp.tool()` decorator |
| Cloudflare Workers bindings | `wrangler.toml` anywhere in the workspace: `d1_databases` and `kv_namespaces`, joined to the code by the binding name |
| OpenTelemetry | OTLP over HTTP, protobuf and JSON, `gen_ai.*` attributes |

`create_react_agent` is read in its Python spelling only. The JavaScript prebuilt helper takes a different shape, and
reading it the same way would be a guess rather than a fact.

Each row names an ecosystem with a fixture repository, written the way that framework's own documentation writes it, and
a test asserting the components, the relations and the evidence. A fixture is a temporary repository the test writes from
source text it holds, in `packages/discovery/test/adapters.test.ts` and `packages/discovery/test/discover.test.ts`, using
the workspace builder in `packages/testkit`. A framework with no fixture is one Orchescope does not claim to understand.

More is implemented than this table claims. An adapter reads shapes no fixture pins yet, and an untested shape is not a
claim this repository makes, so measure a syntax the table does not name before you rely on it.

A fixture agrees with its author, so every adapter is also measured against real repositories pinned at a commit in
[`corpus/corpus.yaml`](corpus/corpus.yaml), with what it finds in each of them committed beside it. That is what says how
much of a repository was actually parsed, which adapter contributed what, and which frameworks a repository uses that an
adapter read nothing from. See [the corpus guide](docs/guides/corpus.md).

Anything else can be declared in `.orchescope/manifest.yaml`, which is a first class input rather than a fallback. A file
in a language Orchescope cannot parse is reported as not inspected rather than ignored: Go, Rust, Java, Kotlin, Swift,
C#, Ruby and PHP are named with their file counts in the coverage report.

## Cost

No price table ships. A price this repository guessed would be wrong the week a provider changed it, and a stale price
turns a measurement into a wrong number reported with the authority of a measurement. Configure your own in
`.orchescope/config.json`, keyed by the provider and model your spans report:

```json
{ "pricing": { "openai/gpt-4o-mini": { "inputPerMillion": 0.15, "outputPerMillion": 0.6 } } }
```

Until one is configured, tokens are reported and cost is not, and the report says which of the two halves is missing
rather than showing zero. A component whose model has no configured price carries no cost rather than a cost of zero.

## Try it on the demonstration system

The repository contains a small multi agent system that runs offline with no credentials and no paid model. It has
deliberate weaknesses, including a retry around a refund whose idempotency is not established.

```
git clone https://github.com/twinkling-reality/orchescope
cd orchescope
pnpm install
pnpm orchescope --cwd apps/demo test --scenario support-desk
pnpm orchescope --cwd apps/demo audit
```

The audit reports the duplicated refund with the span that produced it, offers to turn it into a goal, and after the fix
`orchescope compare` decides from measured runs whether the change worked. That loop is covered end to end by
`tests/e2e/improvement-loop.test.ts`. Coding agents should prefer `orchescope mcp serve` or `--json`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). In short:

```
pnpm install
pnpm check      # format, lint, types, dependency direction, unused code, schema drift
pnpm test       # unit and integration
pnpm test:e2e   # the command line and the improvement loop
```

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
