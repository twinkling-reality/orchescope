# Ecosystem support

Orchescope's source scan is not a universal code review. It reads tested patterns in JavaScript, TypeScript, Python, and
selected configuration files. A coding agent has broader static coverage and found more checkable issues in the measured
[head-to-head audit](../research/orchescope-against-an-agent.md).

This page states the narrower support that tests and the pinned corpus establish. **Discovered from** describes what a
source scan reads. **Joined on a run** describes whether a stored run has matched that source declaration. Support in one
column does not imply support in the other.

| Ecosystem | Discovered from | Joined on a run |
| --- | --- | --- |
| OpenAI Agents SDK (JavaScript, TypeScript and Python) | `new Agent({...})` and `Agent(name=...)`, handoffs, tools, `@function_tool` with `name_override` and `needs_approval`, MCP servers including a command nested in `params`, `maxTurns` | Python and JavaScript |
| LangGraph (JavaScript, TypeScript and Python) | `StateGraph`, `addNode("name", fn)` and `add_node(fn)`, edges, conditional edges, and `create_react_agent(model, tools=[...])` with the model reference it names | Python and JavaScript |
| CrewAI (Python) | `Agent(...)` and `Crew(...)`, an agent returned from a decorated method of a `@CrewBase` class named after that method, and an `agents.yaml` wherever the package holds it, where an agent is named by its declared role or, where that role is a template a run interpolates, by the key it is filed under, including the model its `llm` field names | Python, with the three agents selected by runtime source identity |
| Pydantic AI (Python) | `Agent('provider:model', ...)`, `@agent.tool` and `@agent.tool_plain`, `retries`, `requires_approval`, `output_type` | Python, against an offline model |
| Vercel AI SDK (JavaScript and TypeScript) | `generateText`, `tool(...)`, `maxSteps` | JavaScript, against an offline model |
| Model SDKs | OpenAI, Anthropic and compatible clients, including base URL overrides and a request timeout read at the client or call site | an offline model only, see below |
| Tenacity (Python) | `AsyncRetrying(...)` iterated in a loop and `@retry(...)` over a function, with the ceiling from `stop_after_attempt` and the wait from `wait_exponential` and `wait_random_exponential` | not yet |
| Azure AI Search (Python and JavaScript) | `SearchClient(index_name=...)` and `KnowledgeBaseRetrievalClient`, joined to the function that queries them | not yet |
| Model Context Protocol | `.mcp.json`, `.vscode/mcp.json`, and `FastMCP` including `from mcp.server import` and the `@mcp.tool()` decorator | not yet |
| Cloudflare Workers bindings | `wrangler.toml` anywhere in the workspace: `d1_databases` and `kv_namespaces`, joined to code by binding name | not yet |
| OpenTelemetry | OTLP over HTTP, protobuf and JSON, and `gen_ai.*` attributes | every run in the corpus |

## Important runtime limits

Only one model component in the measured corpus has joined a source declaration, and it is an offline test model. Agents,
tools, and handoffs join. Models often do not because applications choose the model in a configuration position that the
source adapters do not read.

The pinned deep research application names its models in a configuration class. The pinned customer service
demonstration takes an SDK default. The pinned memory agent chooses a default inside the function that reads its
configuration, and the pinned one-agent example names no model. None of those positions is read by a source adapter, so
the run's model is reported as exercised and never declared. The two entries that do declare models drive offline test
models, so they do not establish matching against a real provider.

The provider exercise does establish that one model call is counted once when Orchescope's `fetch` instrumentation and a
target's own instrumentation both observe the request. The corpus entry `openai-agents-js-provider-exercised` pins that
case. Without deduplication, its graph would report eleven models instead of ten because `gen_ai.request.model` records
the request and `llm.model_name` records the response.

Reading model names from additional configuration positions would not close every gap. In the measured deep research
case, the declared default and the model used by the run are different models. No corpus entry establishes a safe rule for
treating a declared model and a provider-returned version as the same component.

## CrewAI join details

A measured CrewAI run reaches this build and all three agents join the constructor frames that ran. Five agent spans from
a three-agent crew are read. The integration records the immediate Python frame that constructed each `Agent`, derives
the canonical Git remote, full revision, repository-relative file, and source range, then attaches those facts to the
later span for that object. The clean pinned run reports three code-location joins, no name-only joins, no ambiguous
names, and no missing source attributes.

CrewAI names an agent by its runtime role. Its generated layout keeps roles in `agents.yaml` and constructs each agent
from the keyed configuration. The source reader uses the declared role as the component name. The pinned repository
declares the same roles in three places, so a name alone cannot select the right declaration. The runtime coordinate
selects the declaration in the exact repository, revision, file, and source range that executed.

Before source capture, this corpus entry reported 155 components, three runtime-only agents, three ambiguous names, and
four findings. With source-qualified matching, it reports 152 components, no runtime-only agent, no ambiguity, and three
findings. A wrong repository, revision, path, or line is refused instead of falling back to a unique-name guess.

The crew itself does not join. Its span carries the OpenInference `CHAIN` kind and no name attribute, so it is counted as
`no_name`. That run reports no relation against sixteen declared relations. It also produces no model span because the
instrumentor writes none unless it is started with an event listener.

The Python spelling of `create_react_agent` is read. The JavaScript prebuilt helper has a different shape and is not
claimed.

## How a support claim is earned

Each source pattern in the table has a fixture test that asserts components, relations, and evidence. Every adapter is
also measured against real repositories pinned in [the corpus](../../corpus/corpus.yaml). The corpus is the stronger
check because a fixture written by an adapter author agrees with that author by construction.

An adapter may contain code for patterns not named here. Untested patterns are not a support claim. Read the coverage
block from `orchescope audit --json` before relying on a scan. It names parsed, skipped, and unsupported files and every
adapter that ran.

Anything else can be declared in `.orchescope/manifest.yaml`. A file in an unsupported language is reported as not
inspected rather than silently ignored. The current coverage report names Go, Rust, Java, Kotlin, Swift, C#, Ruby, and PHP
file counts when present.

See [static audit](static-audit.md), [adapter development](adapter-development.md), and
[the corpus guide](corpus.md) for details.
