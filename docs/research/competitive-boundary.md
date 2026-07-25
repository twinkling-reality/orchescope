# Competitive boundary

What Orchescope is, stated against what already exists. The survey behind this document is
[ecosystem-analysis.md](ecosystem-analysis.md).

## The honest starting position

Stated as a bundle of four features, Orchescope is not differentiated:

| Feature | Already shipped by |
| --- | --- |
| Static discovery of agents, tools and MCP servers, plus a workflow graph | Agentic Radar (Apache-2.0), Agent-Wiz, Cisco AI Defense `aibom` |
| A local browser workspace showing agent runs | Arize Phoenix, Mastra Studio, Langfuse self hosted |
| Structured, severity tagged findings derived from traces | Laminar Signals, LangSmith Insights |
| Evidence linked verdicts tied to a specific trace | promptfoo trace and trajectory assertions |
| Fault injection of 429, 500, timeout and malformed responses from a local proxy | `fault` (fault-cli), Microsoft Dev Proxy, MockServer |
| YAML reliability scenarios with assertions and a generated report | `fault`, promptfoo |
| A coding agent reading observability data over MCP | Langfuse Agent Skill and MCP server, Phoenix MCP server |
| Linking a span to a source location | Datadog Code Origin, OpenTelemetry `code.*` attributes |

Any of those framed as new would be false. A product that ships a graph, a findings list and a scenario
runner without more than that is, in the words of the boundary research, "a worse Agentic Radar bolted
to a worse Phoenix".

## What nobody computes

Every observability graph is inferred from spans, so a component that never executed is invisible to
it. Every static scanner graph is inferred from source, so a component that executed without being
declared is invisible to it. Nobody joins the two.

That join is Orchescope's technical core. It is pinned to a repository revision, and it produces four
addressable deltas:

1. **Declared and never exercised.** Components and relations that exist in the source or in
   configuration and appear in no run. A configured tool nobody calls, a fallback that never fires, an
   MCP server that is committed but never connected.
2. **Exercised and never declared.** Components and relations observed in a trace with no counterpart
   in the static model. A model call from a transitive dependency, a tool added at runtime, an agent
   nobody wrote down.
3. **Declaration contradicted by observation.** A tool annotated `readOnlyHint: true` that performed a
   side effect. A relation with a declared timeout that ran longer. A retry with a declared attempt
   ceiling that exceeded it. An operation declared to need approval that ran without one. The MCP
   specification requires clients to treat annotations as untrusted, which is exactly why measuring
   agreement is worth doing and why the claim is "declared against observed", never "verified safe".
4. **Duplicate side effects attributed to a specific retry of a specific operation.** Not "duplicates
   happened", but which component, which attempt, and whether an idempotency key existed at all.

Each delta is a finding with evidence on both sides of the join, and each one can become a bounded
improvement goal whose acceptance criteria are checked by rerunning the exact scenario that produced
the evidence.

## The second differentiator: the verification contract

An improvement loop from a finding to a change is not new either. Braintrust Loop suggests prompt
edits, and there is published work on generating chaos experiments with a language model. What is thin
in the market is the contract that decides whether the change worked.

An Orchescope goal names the scenarios to rerun, the baseline runs to compare against, the metrics that
must improve, the metrics that must not regress, the write scope the implementer may touch, and the
prohibited changes. A comparison then reports improved, regressed, mixed, unchanged or insufficient
evidence, and refuses a verdict when the sample size does not support one. The precedent is SWE-bench's
`FAIL_TO_PASS` and `PASS_TO_PASS` contract, applied to agent system metrics instead of unit tests.

## The third differentiator: dimensions nobody varies

Existing harnesses throttle themselves; they do not load the system under test, and none of them treat
agent count or communication topology as an experimental variable. Orchescope varies agent count,
worker count, traffic concurrency, topology, model configuration, prompt version, tool configuration
and git revision as separate, named dimensions, and it records tokens, tool calls and wall clock time
for every variant so that a topology comparison is compute normalised rather than flattering.

## Claims that are narrowed on purpose

| Tempting claim | What is actually said |
| --- | --- |
| First tool to map an agent system from source | Others do this. Orchescope maps it and then reconciles it against runs. |
| First local browser workspace for agent systems | Others exist. Orchescope's is offline, repository aware and needs no container. |
| Evidence linked findings are new | They are not. Fusing static and runtime evidence in one graph is. |
| Verifies MCP tool annotations | Reports agreement or disagreement between a declaration and an observation. Annotations remain untrusted. |
| Agent specific fault injection is new | Local proxy fault injection exists. Attributing a duplicate side effect to a specific retry of a specific declared tool is the new part. |
| Statistically significant benchmark results | Distributions, sample sizes and withheld quantiles. No significance claims. |
| Exactly once tool execution | At least once, with duplicate detection. |
| Prompt injection is handled | Boundaries where untrusted content reaches a prompt are identified. Nothing is claimed to be safe. |

## What Orchescope deliberately does not build

- A trace ingest backend, a columnar trace store or a span waterfall dashboard.
- Prompt management, a prompt playground, an evaluator metric library or a cost dashboard.
- An LLM gateway or proxy for production traffic.
- An adversarial prompt corpus, jailbreak strategies, MCP tool poisoning heuristics or skill payload
  detection.
- A single server MCP debugger.
- A Kubernetes chaos operator, a TCP level fault proxy or a containerised benchmark task suite.
- A workflow execution engine or scheduler.
- A hosted experiment tracking service.

Each of those is occupied by a maintained project, most under a permissive licence, and several are
free to self host. Integration over reimplementation is the rule.

## Integrations ranked by value over effort for a first release

1. **OTLP/HTTP receiver accepting protobuf and JSON.** Any instrumented system reaches Orchescope with
   one environment variable, and unmodified SDKs work with none. Highest value, already implemented.
2. **OpenInference dialect ingestion.** One mapping table extends compatibility to the Phoenix and
   LlamaIndex instrumentation ecosystem. Implemented.
3. **MCP configuration discovery across four file shapes.** Cheap, and it makes the graph look complete
   on repositories that use MCP at all. Implemented.
4. **MCP server exposing Orchescope itself.** Table stakes for agent invocation, not a differentiator.
   Implemented.
5. **SARIF export of findings.** Lets results flow into existing code scanning. Implemented.
6. **Mermaid export.** Cheap, expected, useful in pull requests. Implemented.
7. **OWASP and MITRE ATLAS tags on security findings.** Comparability with other tools, applied only
   where the mapping is unambiguous. Implemented.
8. **Importing an existing static graph from another scanner.** Deferred. It needs a validated import
   path per tool and there is no evidence yet that users want it.
9. **Driving an external red teaming tool.** Deferred. It would mean owning credentials and cost
   budgets for someone else's attack corpus.

## Categories too crowded to enter generically

Observability backends, evaluation metric libraries, red teaming corpora, LLM gateways and hosted
experiment tracking. Orchescope competes in none of them. It sits next to them, reads what they emit,
and answers the question they structurally cannot: does the system you declared match the system that
ran, and did your change actually make it better.
