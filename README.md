# Orchescope

Map, test, and improve agent systems.

Orchescope reads an agent system's source, ingests what it does when it runs, and reports the difference between the two.
It runs on your machine, writes only inside the repository you point it at, and sends nothing anywhere.

```
orchescope audit --open
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
- It does not guess at semantics with a model unless you enable that explicitly, and it never sends a whole repository.
- It does not claim your system is safe. It reports what it found and what it could not inspect.

## Install

Node.js 24 or newer is required. There is no compiler step and no native build on install.

**This is not published to npm yet.** Until it is, install the artifact this repository builds:

```
pnpm install
pnpm package                       # builds the bundle and the browser workspace, packs, installs and audits with it
npm install -g release/orchescope-0.1.0.tgz
```

`pnpm package` also installs the tarball into a temporary prefix and audits a project with it, so a failure there means the
artifact is broken rather than your machine.

Once published, the intended distribution is the usual one, and every command in this document works the same way:

```
npm install -g orchescope
npx orchescope audit --open
```

Maintainers: the unit that gets published is `release/stage`, not `apps/cli`. See [docs/guides/release.md](docs/guides/release.md).

## Quickstart

From the root of a repository that contains an agent system:

```
orchescope audit --open
```

That discovers the system, reconciles it against any runs already stored, writes a report, and serves it from loopback
with a one time token in the URL. Nothing is opened in a browser unless you pass `--open`.

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
| `orchescope test --scenario <id>` | Run a scenario and evaluate it |
| `orchescope benchmark --scenario <id> --agents 1,2,4` | Vary one dimension and compare the variants |
| `orchescope chaos --scenario <id>` | Inject the faults a scenario declares and report what each one did |
| `orchescope compare <baseline> <candidate>` | Compare two runs, scans or revisions |
| `orchescope goal create <finding-id>` | Turn a finding into a bounded improvement goal |
| `orchescope goal validate <goal-id>` | Judge a goal against measured evidence |
| `orchescope open` | Serve the most recent report from loopback |
| `orchescope export --format <json\|mermaid\|sarif\|html>` | Export the report |
| `orchescope mcp serve` | Speak the Model Context Protocol on stdio |
| `orchescope init` | Create `.orchescope` with a configuration file listing every default |
| `orchescope init --manifest` | Also write a manifest template for a system no adapter can read from source |
| `orchescope doctor` | Check that this machine can run every command this build offers |

Every command accepts `--json` and then writes exactly one JSON document to standard output, including on failure. The
document has the same four keys whatever happened, so a caller never special cases an outcome:

```json
{ "ok": true, "command": "audit", "version": "0.1.0", "data": { "…": "…" } }
{ "ok": false, "command": "audit", "version": "0.1.0", "data": null, "error": { "code": "…", "category": "…", "message": "…" } }
```

Exit codes are part of the interface: `0` success, `1` findings at or above a `--fail-on` threshold, `2` a caller mistake,
`3` refused by policy, `4` the audited system failed, `5` the environment is missing something, `130` interrupted.

## Architecture

Layers depend inward only, and the boundary is enforced in continuous integration by a dependency rule set rather than
by convention:

```
schema      versioned data contracts, no internal dependencies
domain      identities, invariants, statistics; may only reach node:crypto
core        graph, discovery, traces, findings, scenarios, benchmark, chaos, comparison, goals, report
adapters    source analysis, persistence, process runtime, redaction, observability
assembly    workspace, use cases
edges       command line, agent interface, report server, browser workspace, demonstration system
```

The unified system graph is the centre. Component identity is `(kind, namespace, local name)` rather than a line number,
so an identifier survives an edit and a finding can be compared across scans. Every persisted document carries a schema
version, and every schema is emitted as JSON Schema under `schemas/`.

See [docs/architecture/overview.md](docs/architecture/overview.md) and
[docs/architecture/module-boundaries.md](docs/architecture/module-boundaries.md).

## Privacy

Everything stays on your machine.

- No account, no network calls, no telemetry, no upload. Model based analysis is off by default and refuses to run
  without an explicit setting, a provider and a credential you supply.
- The report server binds to loopback, requires a capability token, and refuses a cross site read.
- State lives in `.orchescope/state/` inside the repository you audit, which the `init` command adds to a local
  `.gitignore`. Configuration is meant to be committed; state is not.
- Exported reports are redacted with a pattern set before they leave the process. Redaction reduces exposure; it is not a
  guarantee, and the report says so.

See [docs/security/data-handling.md](docs/security/data-handling.md).

## Security warning

Orchescope executes the system you point it at. `trace`, `test`, `benchmark` and `chaos` start your processes with your
environment. Chaos injects faults into a running system, and prompt injection scenarios feed hostile text to your agents
on purpose.

Nothing here makes those operations safe. Orchescope bounds them: process execution is refused unless the configured
allow list names the command, live chaos environments are refused unless you enable them, cost and duration and
concurrency have ceilings, and a retry around an operation with no established idempotency is reported rather than
assumed safe. Run it against a system whose side effects you are prepared to have happen, in an environment where that
is acceptable.

See [SECURITY.md](SECURITY.md) and [docs/security/threat-model.md](docs/security/threat-model.md).

## Ecosystem support

Only what is tested is claimed. Each of these has an adapter exercised by tests in this repository:

| Ecosystem | Discovered from |
| --- | --- |
| OpenAI Agents SDK (JavaScript, TypeScript and Python) | `new Agent({...})` and `Agent(name=...)`, handoffs, tools, `@function_tool` with `name_override` and `needs_approval`, MCP servers including a command nested in `params`, `maxTurns` |
| LangGraph (JavaScript, TypeScript and Python) | `StateGraph`, `addNode("name", fn)` and `add_node(fn)`, edges, conditional edges |
| CrewAI (Python) | `Agent(...)`, `Crew(...)`, `agents.yaml`, `crew.jsonc` |
| Pydantic AI (Python) | `Agent('provider:model', ...)`, `@agent.tool` and `@agent.tool_plain`, `retries`, `requires_approval`, `output_type` |
| Vercel AI SDK (JavaScript and TypeScript) | `generateText`, `streamText`, `generateObject`, `tool(...)`, `maxSteps` |
| Model SDKs | OpenAI, Anthropic and compatible clients, including base URL overrides |
| Model Context Protocol | `mcp.json`, `.mcp.json`, `.vscode/mcp.json`, `McpServer`, `FastMCP`, tool registration |
| OpenTelemetry | OTLP over HTTP, protobuf and JSON, `gen_ai.*` and OpenInference attributes |

Each row names an ecosystem with a fixture repository under `packages/discovery/test`, written the way that framework's own
documentation writes it, and a test asserting the components, the relations and the evidence. A framework with no fixture is
one Orchescope does not claim to understand.

Anything else can be declared in `.orchescope/manifest.yaml`, which is a first class input rather than a fallback. A file
in a language Orchescope cannot parse is reported as not inspected rather than ignored.

## Try it on the demonstration system

The repository contains a small multi agent system that runs offline with no credentials and no paid model. It has
deliberate weaknesses, including a retry around a refund whose idempotency is not established.

```
git clone https://github.com/athledev-labs/orchescope
cd orchescope
pnpm install
pnpm orchescope --cwd apps/demo test --scenario support-desk
pnpm orchescope --cwd apps/demo audit --open
```

The audit reports the duplicated refund with the span that produced it, offers to turn it into a goal, and after the fix
`orchescope compare` decides from measured runs whether the change worked. That loop is covered end to end by
`tests/e2e/improvement-loop.test.ts`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). In short:

```
pnpm install
pnpm check      # format, lint, types, dependency direction, unused code, schema drift
pnpm test       # unit and integration
pnpm test:e2e   # the command line and the improvement loop
pnpm test:ui    # the browser workspace, needs: pnpm exec playwright install chromium
```

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
