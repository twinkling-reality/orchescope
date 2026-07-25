# Ecosystem analysis

Survey of the tools and standards that surround Orchescope, done before any code was written, so that
the implementation adopts what exists and builds only what does not. Nine areas were researched
against primary sources during July 2026. Version numbers and dates are what the registries and
repositories reported at that time; they are recorded so that a stale claim is visible as stale rather
than silently wrong.

Everything below is either "adopt", "integrate", "do not rebuild" or "differentiated from". The
conclusions that shaped the product are collected in [competitive-boundary.md](competitive-boundary.md).

## Agent and LLM observability

| Tool | Local first | Static model of the code | Verdict |
| --- | --- | --- | --- |
| [Langfuse](https://github.com/langfuse/langfuse) | Self host with Postgres, ClickHouse, Redis, S3 | No | Do not rebuild |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | Yes, single container, SQLite | No | Do not rebuild |
| [Laminar](https://github.com/lmnr-ai/lmnr) | Yes, docker compose | No | Do not rebuild |
| [Helicone](https://github.com/Helicone/helicone) | Yes, all in one container | No | Do not rebuild |
| LangSmith | Enterprise licence required | No | Differentiated from |
| Braintrust, W&B Weave, Logfire, Datadog LLM Observability | Cloud or Kubernetes | No | Differentiated from |

Findings that matter for Orchescope:

- The category is mature and converging on OpenTelemetry as the wire format. Building a trace ingest
  backend, a columnar trace store or a span waterfall dashboard would be rebuilding free software.
- Every graph these products draw is inferred from observed spans. A component that never executed
  cannot appear in it, and node identity is a span name rather than a code symbol.
- Structured findings from traces already exist. Laminar Signals emit schema conforming records with
  critical, warning and info severity, and LangSmith Insights clusters traces into reports. Orchescope
  must not claim novelty there.
- Coding agent access to observability data already exists. Langfuse ships a CLI, an MCP server and an
  Agent Skill for Claude Code, Cursor and Windsurf; Phoenix ships a CLI and an MCP server. Orchescope's
  MCP interface is table stakes, not a differentiator.
- Arize Phoenix sets the local first bar: `pip install`, SQLite by default, documented air gapped
  operation. Orchescope has to meet or beat that, and it does so by needing no container at all.

Note on licences: Phoenix is Elastic License 2.0, which restricts providing the software as a hosted
service. Orchescope interoperates over OTLP and does not vendor or fork it.

## OpenTelemetry generative AI conventions and OTLP

This is the area where the research changed the implementation most.

- The `gen_ai.*` conventions moved out of the core semantic conventions repository into
  [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai).
  Every attribute there is at development stability. Orchescope therefore versions its mapping and
  never describes the generative AI schema as stable.
- `gen_ai.system` is replaced by `gen_ai.provider.name`. `gen_ai.usage.prompt_tokens` and
  `gen_ai.usage.completion_tokens` are replaced by `gen_ai.usage.input_tokens` and
  `gen_ai.usage.output_tokens`. Orchescope reads the deprecated names for compatibility and never
  emits them.
- `gen_ai.operation.name` is the primary node type discriminator, with values including `chat`,
  `text_completion`, `embeddings`, `retrieval`, `create_agent`, `invoke_agent`, `execute_tool`,
  `invoke_workflow`, `plan` and the memory operations.
- Prompt and result content attributes (`gen_ai.input.messages`, `gen_ai.output.messages`,
  `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, `gen_ai.retrieval.documents`) are opt in and
  off by default. Orchescope's evidence quality therefore degrades gracefully to attribute and span
  shape evidence, and a system that leaves content capture off is reported as a strength rather than as
  missing data.
- There is no cost attribute in the registry. Any cost figure is derived from token counts and a user
  supplied price table, and it is labelled as derived rather than observed. Orchescope ships no price
  table for this reason.
- [OTLP](https://opentelemetry.io/docs/specs/otlp/) trace, metric and log signals are stable. The
  receiver accepts `POST /v1/traces` with `application/x-protobuf` and `application/json`, handles
  `Content-Encoding: gzip`, and answers with `ExportTraceServiceResponse`, using `partialSuccess` when
  spans are rejected. OTLP/JSON deviates from canonical ProtoJSON in three ways that a stock library
  gets wrong: trace and span identifiers are hex strings rather than base64, enums are integers, and
  64 bit integers are decimal strings on encode while both strings and numbers must be accepted on
  decode.
- [OpenInference](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md) is
  ingested as a second dialect and mapped into the same model, including `openinference.span.kind`,
  `llm.model_name`, `llm.token_count.*` and the `graph.node.*` attributes.
- OpenTelemetry `code.*` attributes (`code.file.path`, `code.function.name`, `code.line.number`) and
  `vcs.*` attributes are the join key between an observed span and a statically discovered component.
  This is the reconciliation primitive, and it is a standard rather than an Orchescope invention.

## Evaluation and benchmarking

Existing schemas were read before Orchescope's scenario format was designed, so that field names are
recognisable where the semantics match.

- [promptfoo](https://www.promptfoo.dev/docs/tracing/) already ships trace and trajectory assertions
  over an OTLP receiver, including `trace-span-count`, `trace-error-spans` and `trajectory:tool-used`.
  Evidence linked verdicts tied to a trace are not novel.
- [UK AISI Inspect](https://inspect.aisi.org.uk/eval-logs.html) has a typed `Sample` shape, a versioned
  log format with a published JSON Schema, layered concurrency limits and epoch reducers including a
  `pass_k` estimator.
- Harbor and SWE-bench define task packaging and a verification contract: `FAIL_TO_PASS` and
  `PASS_TO_PASS` sets are the precedent for the acceptance criteria in an Orchescope goal.
- `pass^k` from [tau-bench](https://arxiv.org/abs/2406.12045) is the right reliability metric for
  repeated runs, and Orchescope reports it rather than a bare success rate.
- No mainstream harness parameterises agent count or communication topology as an experimental
  variable, and every concurrency knob in them throttles the harness rather than loading the system
  under test. That gap is real and Orchescope fills it, but the distinction has to be stated precisely
  so that a runner throttle is never presented as load testing.
- Published evidence on whether more agents help is split, and the compute normalised studies find that
  unaccounted computation explains much of the reported multi agent advantage. Orchescope therefore
  records tokens, tool calls and wall clock time for every variant and refuses to claim an improvement
  from latency alone.

## Security and static analysis

Static discovery of agents, tools and MCP servers from source is an occupied category.

- [Agentic Radar](https://github.com/splx-ai/agentic-radar) (Apache-2.0) scans agentic frameworks and
  renders a workflow graph with an OWASP mapped report. [Agent-Wiz](https://github.com/Repello-AI/Agent-Wiz)
  emits a JSON node and edge graph across ten frameworks. Cisco AI Defense `aibom` detects agent, tool,
  MCP server and MCP client component types and emits CycloneDX, SPDX and SARIF.
- MCP artifact risk analysis is covered by `snyk/agent-scan` (formerly Invariant Labs mcp-scan),
  `cisco-ai-defense/mcp-scanner` and Semgrep's AI rule set, which already includes tool poisoning, MCP
  SSRF and command injection rules.
- Dynamic red teaming is covered by [garak](https://github.com/NVIDIA/garak), Microsoft PyRIT and
  promptfoo's red team plugins. Orchescope authors no adversarial prompt corpus.
- Taxonomies adopted for finding tags: OWASP Top 10 for LLM Applications 2025, OWASP Top 10 for
  Agentic Applications 2026, and MITRE ATLAS technique identifiers. Tags are attached only where the
  mapping is unambiguous.
- [SARIF 2.1.0](https://www.oasis-open.org/standard/sarifv2-1-os/) is the export format for findings so
  that results flow into existing code scanning dashboards.

Two tools in this area require an external LLM API to analyse a repository, and one sends tool names
and descriptions off machine. Staying fully local is a real difference worth protecting.

## Model Context Protocol and coding agent integration

- MCP tool annotations are adopted verbatim as the safety vocabulary: `readOnlyHint` (default false),
  `destructiveHint` (default true), `idempotentHint` (default false), `openWorldHint` (default true).
  The specification requires clients to treat annotations as untrusted, so Orchescope reports declared
  against observed agreement and never says an annotation is trustworthy.
- Configuration discovery targets four documented shapes, and they do not agree on the top level key:
  `.mcp.json` and `~/.claude.json` use `mcpServers`, `.vscode/mcp.json` uses `servers`,
  `.cursor/mcp.json` uses `mcpServers`, and `claude_desktop_config.json` uses `mcpServers`. A parser
  keyed only on `mcpServers` silently misses every VS Code workspace.
- Environment interpolation differs by client: `${VAR}` and `${VAR:-default}` in one dialect,
  `${env:NAME}`, `${userHome}` and `${workspaceFolder}` in another, plus `envFile` and `inputs`
  indirection. Full server configuration therefore cannot always be resolved statically, and Orchescope
  says so instead of guessing.
- A committed MCP configuration is not proof that a server ran. Declared but never connected is a
  common state, and it is exactly the kind of thing the reconciliation delta exists to show.
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the single server interactive
  debugger. Orchescope does not build one.
- `AGENTS.md` is consumed as it is, with no Orchescope schema added to it. Agent Skills (`SKILL.md`) is
  the packaging format for repeatable procedures.

## Chaos engineering and fault injection

- The vocabulary is settled and adopted rather than reinvented: Toxiproxy's toxic model with a
  probability modifier, Chaos Mesh HTTP fault actions (`abort`, `delay`, `replace`, `patch`), and the
  CNCF chaos engineering glossary terms steady state, hypothesis and blast radius.
- LLM specific injection already exists. Microsoft Dev Proxy ships named language model failure modes
  and token window rate limiting, `fault` (fault-cli) injects latency, errors and stream corruption
  from a local proxy with YAML scenarios and SLO assertions, and MockServer provides seeded
  probabilistic chaos including malformed bodies and truncated responses. Orchescope claims none of
  this as new.
- Research has begun formalising agent fault taxonomies, including transient timeouts, rate limits,
  partial responses and schema drift scored with `pass^k`, and injection through prompt modification,
  response rewriting and message routing manipulation.
- Idempotency references adopted for findings and recommendations: RFC 9110 section 9.2.2, the
  `Idempotency-Key` header convention, and the operational pattern of storing the first status and body
  and replaying it. Orchescope detects the missing key and verifies the fix; it does not become the
  implementation.
- Agent tool execution is at least once, not exactly once. Orchescope's output never says exactly once.

## Frameworks to discover

Adoption was measured from registry APIs, not from impressions. Monthly download figures reported in
July 2026, rounded:

| Ecosystem | Package | Downloads per month |
| --- | --- | --- |
| PyPI | `openai` | 371 M |
| PyPI | `langchain` | 313 M |
| PyPI | `anthropic` | 170 M |
| PyPI | `langgraph` | 68 M |
| PyPI | `openai-agents` | 33 M |
| PyPI | `claude-agent-sdk` | 26 M |
| PyPI | `crewai` | 11 M |
| npm | `@modelcontextprotocol/sdk` | 177 M |
| npm | `openai` | 114 M |
| npm | `@anthropic-ai/sdk` | 107 M |
| npm | `ai` | 72 M |
| npm | `@anthropic-ai/claude-agent-sdk` | 31 M |
| npm | `@langchain/langgraph` | 11 M |
| npm | `@openai/agents` | 5 M |

Consequences for the first release:

- The two deeply supported source ecosystems are TypeScript or JavaScript and Python, because that is
  where the adoption is and because both have a compiler free parsing path.
- Raw model SDK usage outweighs every framework by an order of magnitude, so hand rolled agent loops
  must be detected, and they are reported at lower confidence than a declared topology.
- Microsoft AutoGen is in maintenance mode upstream. Detecting it and saying so is more useful than
  writing an adapter for it.
- `ai` (the Vercel AI SDK) has very high volume, but most of that surface is single shot text
  generation with no agent topology. Detection distinguishes the two.

## Graph visualisation for the browser workspace

- The binding constraint at scale is edge count, not node count. Published benchmark work on canvas
  and WebGL renderers shows a collapse between roughly 16,000 and 68,000 edges, so the report
  aggregates edges and hides them during interaction rather than quoting a node count.
- Accessibility is the inverse of rendering performance. WebGL and canvas renderers ship no ARIA
  support at all, so the accessible representation has to be a separate DOM structure that Orchescope
  owns. The report therefore renders the same data twice: a canvas graph and a keyboard navigable table
  with the WAI-ARIA treegrid keyboard pattern.
- Mermaid is an export format, not a renderer for this data. Its default limits are 500 edges and
  50,000 characters, both hard failures, and its render path inserts an inline style element with no
  nonce, which breaks a strict content security policy. Orchescope exports Mermaid text sliced per
  subsystem and never runs Mermaid in the report page.
- `elkjs` was evaluated for layered layout and rejected on licence grounds, since its package declares
  `EPL-2.0 OR GPL-3.0-or-later`. `@dagrejs/dagre` is MIT, deterministic across runs and fast enough,
  and layout happens in the CLI.

## Name and scope collision

Direct registry lookups performed on 2026-07-24 returned HTTP 404 for `orchescope` on the npm
registry, PyPI, crates.io and both Homebrew formula and cask APIs, and both npm and crates.io keyword
searches returned zero results. Trademark aggregator searches for `orchescope` and near variants
returned no records while control queries in the same session returned results, so the search itself
was working.

No serious legal or technical conflict was found, so the display name stays Orchescope. This is not a
trademark clearance opinion: the primary trademark office endpoints were unavailable during the
research, so a formal search by counsel remains outstanding before any commercial use. No package name
has been claimed and nothing has been published.

Names deliberately avoided for modules and subcommands because they belong to existing projects:
AgentScope, AgentOps, Orchestra. The word "scenario" collides with PyRIT's architecture, which is
acknowledged in [docs/protocols/scenario-schema.md](../protocols/scenario-schema.md) rather than
worked around.
