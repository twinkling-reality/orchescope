# Orchescope

Map, test, and improve agent systems.

Orchescope reads an agent system's source, ingests what it does when it runs, and reports the difference between the two.
It runs on your machine, writes only inside the repository you point it at, and sends nothing anywhere.

## Install

Node.js 24 or newer is required. There is no compiler step and no native build on install.

```
npm install -g orchescope
cd <your agent system>
orchescope audit
```

Or without installing anything:

```
npx orchescope audit
```

## The loop

There is one thing to learn and it is a loop of five steps. `orchescope audit` prints what it found, which step the
repository is standing at, and the single next thing to run. Every command answers with the same block, so nothing has
to be remembered or sequenced by hand.

| Step | What it establishes | What runs it |
| --- | --- | --- |
| 1 Audit | what is declared, what has run, and the difference | `orchescope audit` |
| 2 Goal | one finding as a bounded task, with the check that decides it | `orchescope goal create <finding-id>` |
| 3 Rerun | the same scenario with the same seed, after the change | `orchescope test --scenario <id>` |
| 4 Measure | what that run took, cost, retried and duplicated | recorded by the rerun |
| 5 Did it help | the before against the after, on measured evidence | `orchescope goal validate <goal-id>` |

An audit of a repository with no runs stored says so rather than guessing, and asks for one. Your process reports spans
to a loopback receiver that exists only for the duration of the run:

```
orchescope trace -- node src/main.js
orchescope audit
```

Orchescope never guesses that command. To declare it once instead of typing it each time, `orchescope init
--scenario` writes a scenario template: fill in `target.command`, move it to `scenarios/`, and every rerun,
comparison and verdict after that runs from the file. The template offers whatever the repository already
declares as commented candidates, each with the file and line it was read from, and runs none of them.

**A coding agent runs the same loop without you.** `orchescope mcp serve` exposes it over the Model Context Protocol,
and the server tells a connecting agent to call `audit_agent_system` first and then follow `loop.next.tool`, which names
the tool and the arguments for the step the repository is standing at. The same facts are on the command line under
`--json`. Nothing in the loop needs a person, and nothing in it needs a browser.

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

## Core commands

| Command | What it does |
| --- | --- |
| `orchescope audit` | Discover the system, reconcile it against stored runs, report findings |
| `orchescope trace -- <command>` | Run a command, collect its OpenTelemetry spans, store them as a run |
| `orchescope federate --repository <path>...` | Join separately scanned repositories using source-qualified runtime evidence |
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
| `orchescope init --scenario` | Also write a scenario template that declares how the system is started |
| `orchescope doctor` | Check that this machine can run every command this build offers |

Every command accepts `--json` and then writes exactly one JSON document to standard output, including on failure. The
document has the same four keys whatever happened, so a caller never special cases an outcome:

```json
{ "ok": true, "command": "audit", "version": "0.9.0", "data": { "…": "…" } }
{ "ok": false, "command": "audit", "version": "0.9.0", "data": null, "error": { "code": "…", "category": "…", "message": "…" } }
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

## Verify what you installed

The same archive is attached to every release with its sha256 beside it, and `pnpm package` reproduces it from this
repository, so you can check that what you installed is what this source builds:

```
pnpm install
pnpm package                       # builds the bundle, packs, installs and audits with it
npm install -g release/orchescope-0.9.2.tgz
```

`pnpm package` also installs the tarball into a temporary prefix and audits a project with it, so a failure there means the
artifact is broken rather than your machine.

Maintainers: the unit that gets published is `release/stage`, not `apps/cli`. See [docs/guides/release.md](docs/guides/release.md).

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

Only what is tested is claimed, and this product has two halves that are tested separately. **Discovered
from** is what a scan reads out of a repository. **Joined on a run** is whether a real stored run of a real
system has ever matched what that scan declared, which is the reconciliation everything else here is built
on. A row can be solid in the first column and empty in the second, and the difference is not cosmetic:
every dialect measured for the first time has changed what this build reports about it.

| Ecosystem | Discovered from | Joined on a run |
| --- | --- | --- |
| OpenAI Agents SDK (JavaScript, TypeScript and Python) | `new Agent({...})` and `Agent(name=...)`, handoffs, tools, `@function_tool` with `name_override` and `needs_approval`, MCP servers including a command nested in `params`, `maxTurns` | Python and JavaScript |
| LangGraph (JavaScript, TypeScript and Python) | `StateGraph`, `addNode("name", fn)` and `add_node(fn)`, edges, conditional edges, and `create_react_agent(model, tools=[...])` with the model reference it names | Python and JavaScript |
| CrewAI (Python) | `Agent(...)` and `Crew(...)`, an agent returned from a decorated method of a `@CrewBase` class named after that method, and an `agents.yaml` wherever the package holds it, where an agent is named by its declared role or, where that role is a template a run interpolates, by the key it is filed under, including the model its `llm` field names | Python, with the three agents selected by runtime source identity |
| Pydantic AI (Python) | `Agent('provider:model', ...)`, `@agent.tool` and `@agent.tool_plain`, `retries`, `requires_approval`, `output_type` | Python, against an offline model |
| Vercel AI SDK (JavaScript and TypeScript) | `generateText`, `tool(...)`, `maxSteps` | JavaScript, against an offline model |
| Model SDKs | OpenAI, Anthropic and compatible clients, including base URL overrides and a request timeout read at the client or the call site | an offline model only, see below |
| Tenacity (Python) | `AsyncRetrying(...)` iterated in a loop and `@retry(...)` over a function, with the ceiling from `stop_after_attempt` and the wait from `wait_exponential` and `wait_random_exponential` | not yet |
| Azure AI Search (Python and JavaScript) | `SearchClient(index_name=...)` and `KnowledgeBaseRetrievalClient`, joined to the function that queries them, as the retrieval source a prompt injection boundary is measured against | not yet |
| Model Context Protocol | `.mcp.json`, `.vscode/mcp.json`, and `FastMCP` including `from mcp.server import` and the `@mcp.tool()` decorator | not yet |
| Cloudflare Workers bindings | `wrangler.toml` anywhere in the workspace: `d1_databases` and `kv_namespaces`, joined to the code by the binding name | not yet |
| OpenTelemetry | OTLP over HTTP, protobuf and JSON, `gen_ai.*` attributes | every run in the corpus |

**One model component has ever joined a declaration, and it is an offline test model.** Agents, tools and
handoffs join. Models do not, and the reason is worth stating exactly, because it is not what it looks
like.

A model is chosen where a run is configured rather than where an agent is written. The pinned deep research
application names its models in `Field(default="openai:gpt-4.1")` on a configuration class; the pinned
customer service demonstration names none at all and takes the SDK's default; the pinned memory agent
defaults to a literal inside the function that reads its configuration; the pinned one agent example names
none either. None of those is a position any adapter here reads a model reference from, so on all of them
the static side declares no model for the run to match, and the run's model arrives as exercised and never
declared. The two entries that do declare models drive an offline model, so nothing overlaps there either.

**What a run against a real provider does now show is that one model call is read as one.** `orchescope
trace` patches `fetch`, and a target with its own instrumentation has two producers watching the same
request. `openai-agents-js-provider-exercised` is the entry that measures it: the graph without a run holds
nine models, that entry records ten, and read as two calls it would record eleven, because
`gen_ai.request.model` is what was sent and `llm.model_name` is what came back and both are real names.

Reading a model named in a configuration default is what would have to change. It would not close the gap
on its own: that deep research default is `openai:gpt-4.1` and the run measured here asked for
`openai:gpt-4.1-mini`, which are two models and should not join. Nothing in this corpus yet shows a
declared model and an observed model that differ only by the version the provider answered with, so no rule
here matches on one.

**A CrewAI run reaches this build and all three agents join the constructor frames that ran.** Five agent
spans of a three-agent crew are read. The bounded CrewAI instrumentation integration records the immediate
Python frame that constructed the actual `Agent` object, derives the canonical Git remote, full revision and
repository-relative file from that frame, and puts those facts on the later span for the same object. The
clean pinned run reports `byCodeLocation: 3`, no name-only joins, no ambiguous names and no missing source
attributes.

CrewAI names an agent by its role at run time. The layout `crewai create crew` generates writes that role in
`src/<package>/config/agents.yaml` and builds the agent with
`Agent(config=self.agents_config['lead_market_analyst'])`. That document is now read where the package holds
it and the role in it names the component, so the run's name for an agent is in the graph. The pinned
repository declares each role three times, once in the crew that ran, once in a copied integration and once
in an application the run never entered. A name still cannot select among them. The runtime coordinate
points to `crews/marketing_strategy/src/marketing_posts/crew.py` at the pinned commit, and each executing
line falls inside exactly one of that file's three declared source ranges.

That movement is narrower than a name heuristic. Before source capture the entry reported 155 components,
3 runtime-only agents, 3 ambiguous names and 4 findings. It now reports 152 components, no runtime-only
agent, no ambiguity and 3 findings. The three competing declarations remain separate, and a wrong repository,
revision, path or line is refused rather than allowed to fall back to the unique-name rule.

The crew does not join either, for a different reason. Its span carries the OpenInference `CHAIN` kind and no
name attribute, so it is declined and counted as `no_name`, which also means nothing nests inside it: that
run reported no relation at all against sixteen declared. No model span is produced, because the instrumentor
writes none unless it is started with an event listener.

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
