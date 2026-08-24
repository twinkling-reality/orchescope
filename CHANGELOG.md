# Changelog

Notable changes per released version. Nothing here is generated; a release is a person writing down what moved and why.

## 0.9.1

Unreleased. `orchescope@0.9.1` is not on the registry and carries no registry attestation. The first frozen candidate,
commit `604fce7516e47cd8971bedbb6da27b138e485fe0` with archive SHA-256
`6210cafc465c56aa2b8ed6d6328499799bd4e6c553327708d1b1141fd522a274`, was independently evaluated and blocked. The
second candidate, commit `48828a1d2f3d8aa479124987a04eb8d672fc63a3` with archive SHA-256
`61603179f78bca84aa21e71d4060aa3b8a500b4a372784be86fe441c62f8ac2b`, was also independently evaluated and blocked.
The third candidate, commit `df99c97c192e12177a7aa78dee012e0dec10bab5` with archive SHA-256
`0670c1ace229159a3bcd6a63ccfa53a7832db58b376272612225b2a7177a4709`, was independently evaluated and blocked as
well. The fourth candidate, commit `d00a06b5c8c45ebfcd1ca75cb2bbdb0951c1e8a7` with archive SHA-256
`9b2834897befd6a6f5288c973bea25a81f4389cff5de17a090545d421c12cfc6`, was independently evaluated and blocked too.
The fifth candidate, commit `724a1abda9a1176b28b5633495d67a6b0e2bc194` with archive SHA-256
`38981b8d9a6a6b626d74c7ae9ebb170cb550217528011270165a207cc5cfbcc5`, was independently evaluated and blocked as well.
The sixth candidate, commit `84c80b2e2ee1935c6925d12b585f02782358f122`, produced the same archive bytes because
its correction changed only the evaluation protocol and corpus records; it was independently evaluated with a different
pair and blocked too. The seventh candidate, commit `97ac6b4e48023ad6fa2e465a702abe4422a16a7d` with archive SHA-256
`91c71ad094f13bf6f28f7a3798db43289c3e126bcc5d1b975ef4a87459956f39`, was independently evaluated and blocked as
well. The eighth candidate, commit `63f31253d5ca58ea29661074561c833b01462fef` with archive SHA-256
`5a0e18d6d37c71d4d9ccd5f4d6a6f8f62bc804b2f01d186bcc105dcce778bfd9`, was independently evaluated and blocked too.
The ninth candidate, commit `1f5fe556db5abd762c43c5d35f0b15e15f7df6df` with archive SHA-256
`1b11e56ba50ece693191d4f1b03e5da9cb2e7492be71b037990af0db7d3b45bc`, was independently evaluated and blocked as
well. After a different pair cleared that candidate, the next candidate, commit
`78c624105fee8f0b4c127cbdbeade583bc5cbdb4` with archive SHA-256
`dc6853a6cc1ec289faeca0cf51ea4afbd8ccaba649394cc05ea7ef6a613112fd`, was independently evaluated and blocked by a
wrong provider identity. Candidate `13383b88c22cfa7c1bb6035ff6a184ad60f61295` with archive SHA-256
`b7c9b14ffffbb1109f713bdea2518f2181ec8931d7de4a7318f745ee60cb8441` was independently evaluated and blocked by an
unsupported database write-permission claim over an exact read-only SQLite connection. None was published, tagged,
pushed or attached to a release. A corrected candidate cannot be published until a different unseen positive and
negative pair clears the blind gate.

### Exact datastore access boundaries determine permission mode

Provider-qualified SQLite clients retain their exact source-declared access boundary. Python `sqlite3.connect` is
read-only only when an exact URI contains `mode=ro` and the call also supplies literal `uri=True`; a URI-shaped filename
without URI handling retains the writable default. Node's exact `node:sqlite.DatabaseSync` constructor is read-only
only with literal `readOnly: true`. Dynamic options establish neither boundary.

The independently selected Fenceline negative exposed the defect: the frozen package cited
`sqlite3.connect(f"file:{path}?mode=ro", uri=True)` while assigning `database:sqlite` write permission and counting one
write in the permissions overlay. The corrected component carries read permission and the overlay consequently counts
zero writes. Corpus acceptance pins exact component permission populations, so a same-count permission substitution is
a semantic failure. Fenceline contributes 33 assertions over its identity, read permission, query relation, evidence,
topology and findings. The selected Job Hunter positive contributes 49 assertions preserving its bounded hand-written
agent support boundary without guessing a generic Agent identity.

### Compatible clients do not establish endpoint-provider ownership

An exact runtime SDK import establishes the SDK's documented default only when no endpoint override is present. An
explicit literal endpoint now resolves provider identity through the bounded shared endpoint-host table. A recognized
alternate endpoint receives its exact provider identity; an unknown custom or dynamic endpoint receives a
source-located provider-ownership refusal. The compatible client class, constructor name and model name do not establish
service ownership. Exact provider-specific SDK exports such as Azure OpenAI retain their own provider identity instead
of inheriting the package vendor's default.

A source-settled model name remains available as an unqualified model component when provider ownership is unresolved,
but it receives no provider-qualified identity or provider-serving relation. The independently selected `gitizens`
holdout exposed the defect by using an OpenAI-compatible client with the exact GitHub Models endpoint and
`GITHUB_TOKEN`; the frozen candidate incorrectly emitted `provider:openai`. The positive is pinned with 74 semantic
assertions covering the agent, model, prompt, relations, endpoint refusals, findings and topology. The selected
`agent-logs-extractor` negative remained correctly empty and adds no distinct precision invariant.

### LangChain chat prompts retain exact provenance and bounded runtime settlement

Exact `langchain_core.prompts.ChatPromptTemplate`, legacy `langchain.prompts.ChatPromptTemplate` and
`@langchain/core/prompts.ChatPromptTemplate` runtime imports now supply prompt-constructor provenance. Direct, renamed
and namespace imports retain their origin; foreign packages, local lookalikes, type-only imports, shadows and rebindings
do not acquire prompt identity. Recognition does not match generic prompt-like class names, so another framework must
supply its own provenance declaration without weakening this boundary.

Direct construction and exact `from_template`, `fromTemplate`, `from_messages` and `fromMessages` factories retain
template, system and human roles. Static text, formal parameters, partial bindings and invocation bindings are settled
in runtime precedence order. Computed formats, unsupported template dialects, mutations, escapes, decorators,
destructuring and unsettled consumers become source-located refusals. No `uses_prompt` relation is emitted merely
because a prompt and workflow step occur in the same callable.

The callable-flow analysis is shared source infrastructure rather than a LangChain exception. It follows bounded
aliases, parameters, defaults, wrappers and nested calls; respects lexical ownership and source order; treats calls of
returned callables as unknown; and proves complete conditional settlement over the whole branch-path tree. One-sided,
nested or overly complex paths preserve reachable prior bindings instead of being cleared by an unrelated branch.

The defect was found by the independently selected `AI-Article-Writer` holdout. The frozen candidate reported its four
LangGraph workflows and 38 relations but silently missed six exact chat prompt components, including prompts receiving
search and retrieved page content, while both the prompt adapter and prompt-injection rule reported not applicable. The
positive is pinned with 59 semantic corpus assertions: six exact prompt identities, their roles and evidence, two
settled interpolation results, no invented `uses_prompt` relation and five exact prompt-use refusals. The selected
`claude-usage` negative was correctly classified as fixed-purpose usage tooling and adds no distinct precision entry.
Both source lineages are permanently ineligible as future blind holdouts.

### AgentFlow graphs retain source identity, topology and invocation ceilings

Exact `agentflow.core` runtime imports now have a dedicated source reader. Direct, renamed and namespace imports retain
their runtime provenance; foreign packages, local lookalikes, shadows and rebindings do not acquire AgentFlow identity.
Recognition does not match generic names such as `Agent`, `ToolNode` or `StateGraph`. The provenance reader is separate
from the graph reader so another framework can supply its own runtime symbols without weakening this identity boundary.

Stable source bindings establish Agent, ToolNode, workflow and workflow-step components. Graph construction, node and
edge registration, compilation and invocation relations require matching lexical scope, source order and settled
control flow. Aliases, container paths, returned locals and destructuring remain supported only while source facts prove
the same value. Computed, escaped, mutated, branch-ambiguous or otherwise unsettled model, prompt, tool, graph or
compiled-app populations become source-located refusals instead of borrowed relations. A ToolNode component can remain
source-supported while its individual tool population is refused.

A positive literal `recursion_limit` at an exact compiled-graph invocation is recorded as an `invocation_ceiling`. It
is not an observed run count, a universal execution bound or a static configuration default. Corpus acceptance locks
the exact configuration-bound facts, producer populations and source-located or deliberately unlocated refusals, so an
aggregate-preserving substitution cannot weaken this boundary.

The defect was found by the independently selected `agentic-browser` holdout. Its supported Python source constructs an
AgentFlow Agent and ToolNode, registers cyclic MAIN/TOOL graph control flow, compiles the workflow and invokes it from a
browser controller. The frozen candidate retained unrelated effects but reported no AgentFlow identity or relation and
no agent system without naming the omitted population. The exact positive is pinned as a source-cited regression. The
selected `claude-log-viewer` negative's no-agent polarity was correct and adds no distinct precision invariant. Both source
lineages are permanently ineligible as future blind holdouts.

### Browser-use agents retain a source-settled execution boundary

Exact `browser_use.Agent` imports now have a dedicated source reader. Direct, renamed and namespace imports preserve
their runtime provenance; foreign modules, local lookalikes and shadows do not acquire browser-use
identity. A direct stable assignment supplies source identity, and one exact Agent returned by a local factory may be
joined to the stable result binding at its call site. Ownerless constructions and repeated factories become
source-located identity refusals. A retained construction whose receiver is rebound, mutated, captured, destructured
or passed through an unsettled operation before a run keeps its construction evidence but does not acquire that run
boundary. Writes after the run cannot be presented as though they preceded it.

The exact `Agent(...)` construction supports the retained agent component. A stable `agent.run(...)` call adds its
execution boundary; an intervening operation instead produces a source-located refusal without erasing the agent. A
computed or factory-carried `llm` input does not become an exact model or provider relation. Dynamic tasks remain
prompt-use refusals, and a runtime-configured `max_steps` value does not become a universal execution bound. Browser
actions selected at runtime do not become a closed source topology. A positive literal run limit is exact only for its
call and is not mislabeled as a configuration default.

Python callable facts distinguish a generator from an ordinary function without lending a nested generator to its
owner, and keep destructuring source references without lending the whole right-hand side to any target. The
fact-cache version is 22 so a scan cannot reuse an earlier callable, assignment or binding-scope fact that omitted
those execution boundaries. A Pydantic AI agent is destabilized only by assignments in its own lexical scope or an
explicit Python `global`/`nonlocal` target; a same-named
destructuring write in another function cannot erase its decorated tools or relations. Nonlocal targets carry the
exact owning callable range, so repeated nested function names do not collapse distinct bindings.
Class-body bindings carry the class namespace range while `nonlocal` lookup continues through the surrounding
function chain, matching Python's closure boundary.

The defect was found by the independently selected `Browser-Automation-Agent` holdout. All 13 supported Python files
parsed, yet the frozen candidate reported zero parts, no agent system and no unsupported input despite its exact
browser-use construction and run call. The positive is pinned as a source-cited component-and-refusal regression.
The selected `claude-codex-usage-dashboard` negative was correctly reported as adjacent local usage tooling and adds no
distinct precision invariant. Both source lineages are permanently ineligible as future blind holdouts.

### Blind negative roles are verified from acquired source

Exclusion clearance proves that a target is unseen and unrelated to the exposed population; it does not prove that the
repository role inferred from public metadata is true. After clearance, both exact pins now receive a bounded source
role review before their scans can support a release decision, and the release owner independently verifies that
review. A proposed negative that constructs or drives an agent, selects tools or actions for a goal, or delegates that
behavior to downloaded code is rejected and replaced. `agentSystemDetected: false` cannot validate a mislabeled
negative.

The defect was exposed by the proposed `tokentab` negative. Alongside its session-log analysis, the exact pin declares
a packaged interactive coding-agent entry point that constructs an Agent, exposes its tools and sends user input to it;
its setup path also downloads and executes Python in memory. It is retired but not added as a negative corpus entry.
The selected `email-agent` positive is pinned instead: one LangGraph workflow, eight source-cited steps, seven literal
conditional transitions, the exact Ollama model/provider identity, three explicit topology refusals and no strengths
or component metrics.

### Legacy LangChain executors are an explicit agent population

Exact `langchain.agents` imports of `create_openai_tools_agent` and `AgentExecutor` now have a dedicated source reader.
It proves the factory-to-executor pair, follows a uniquely returned local factory to each stable assigned call site and
uses the lexical source binding for agent identity. A direct exact factory/executor pair is also supported. Aliases and
namespace imports retain their provider provenance; foreign packages, shadows, reassignments, repeated source bindings
and computed constructions are refused rather than inferred.

Model relations require one exact source-declared client already recognized by the model reader. Tool relations require
a bounded list of unique local functions decorated by the exact LangChain tool export. A prompt passed directly through
the local factory becomes a prompt input; a factory that transforms it beyond the retained facts names that boundary in
a source-located refusal. The graph, JSON, terminal document and exports therefore cannot report a fully parsed
LangGraph application while silently omitting its separate legacy agent layer.

An async wrapper is refused because calling it produces a coroutine rather than an executor. Named tool lists and
factory parameters must remain closed under aliases, containers, assignments and member mutation; an inline literal
list remains bounded. After construction, direct assignments, augmented assignments, deletions and exact attribute
setters on the executor's delegated agent or tools suppress only the affected relations and cite the mutation. Known
executor read and invocation methods remain supported; an unrelated, descendant or otherwise unsettled source
operation produces an endpoint-specific refusal without claiming that the endpoint itself was mutated.

Python write facts retain direct-member versus subscript access and expand tuple, list, parenthesized and starred write
targets to their individual members. A destructured member carries an explicit unknown value unless source facts prove
its positional value; the whole right-hand side is never lent to every member. The fact-cache version changed with
that contract so an audit cannot reuse a less precise write fact.

The defect was found by the independently selected `MultiAgentDiscordBot` holdout. Its local factory returns an
`AgentExecutor`, and four stable call sites create three persistent workers and one request-scoped personality worker
that the active Discord workflow invokes. The frozen candidate reported the workflow but zero agents and no refusal for
those imports. The exact positive is pinned as a source-cited regression. The selected `claude-jsonl-viewer` negative
was correctly reported as a local viewer and contributes no distinct precision invariant. Both source lineages are
permanently ineligible as future blind holdouts.

### Workflow topology is no longer presented as agent identity

LangGraph `StateGraph` construction now produces a `workflow`; each registered node is a `workflow_step`; and declared
control flow is `transitions_to`. Registration establishes that a callable is part of a workflow, not that it delegates
to a model, and adjacency between registered steps is not an agent handoff. Explicit agent factories, including
LangGraph's prebuilt agent factory, still produce `agent`; explicit transfers between agents still produce
`hands_off_to`.

This changes component and relation counts on every LangGraph graph: previous `agent_group` populations move to
`workflow`, node populations previously reported as `agent` move to `workflow_step`, and graph edges previously reported
as `hands_off_to` move to `transitions_to`. The agent-system detection flag remains true for a supported agent-framework
workflow without turning its individual steps into agents. Static and runtime identities use the same vocabulary, and
the graph, report, Mermaid, schema and corpus projections move together.

The defect was found by the independently selected `support-agent-hitl` holdout. Only its `triage` step invokes a model;
approval, refund execution and response formatting are deterministic steps. The frozen candidate nevertheless told the
reader that it found four agents and derived agent handoffs between them, which is a publication-blocking identity
claim. The exact positive is now a source-cited regression at its evaluated revision. Its Ollama model fallback inside
`os.getenv` is retained as a possible static configuration default only when the call resolves to Python's `os` module.
The selected negative contributed no distinct precision invariant and is not duplicated in the corpus. Both source
lineages are permanently ineligible as future blind holdouts.

Mermaid exports label a static component with no run population as `no runtime evidence`, not `not exercised`. The
former states the evidence boundary; the latter asserted an execution absence that a static-only audit could not know.

### Retry findings require call-specific causality and repository verification evidence

A pause inside a loop establishes backoff only after the source proves that the same failed work is attempted again.
Polling reads, device pairing after an explicit non-success response, and durable consumers that commit their offset
before a notification no longer acquire retry policy merely because they wait. Explicit retry helpers, attempt counters,
and guarded passes that exit on success remain supported.

The duplicate-effect rule fires only for a call-specific known non-idempotent effect. It no longer borrows an aggregate
provider effect through a generic wrapper or converts unknown effect semantics into a definite duplicate impact. A true
positive that catches an ambiguous failure and reissues the same known non-idempotent operation remains covered.

Suggested experiments and goal readiness are derived from the repository's own scenarios. The rule names a scenario
only when it targets the affected operation with an ambiguous-result fault and checks duplicate effects; otherwise it
states that the verification scenario is absent and emits no command or prior-verification claim. This changes retry
relation and reliability-finding counts for polling-heavy repositories.

The defect was found by the independently selected `jarvis-home-commander` holdout. Its Telegram offset consumer, OAuth
authorization polling, and bounded HomeWizard pairing are pinned as one source-reviewed regression input. The selected
negative contributed no distinct precision invariant and is not duplicated in the corpus. Both selected source
lineages are permanently ineligible as future blind holdouts.

### Function-scoped compatible clients retain lexical authority

Python imports now carry the function or method that owns their runtime binding. A guarded
`import openai as openai_lib` authorizes `openai_lib.OpenAI(...)` and calls through that client in the same lexical
scope; it does not leak into a sibling function or authorize a use before the import. Parameters, local rebindings,
unrelated packages and imports after a call remain quiet. Repeated assignments to the same client name are resolved
against the nearest source definition inside the control-flow path that owns both construction and use. Conditional,
loop, loop-else, try, try-else, handler and match alternatives cannot lend identity across a join; an unconditional
finally assignment and an ordinary straight-line reassignment can. A call whose receiver remains unsettled is an
explicit unresolved topology input rather than borrowing the provider or model identity of whichever assignment
appears last in the file. It preserves the enclosing agent boundary only when every reachable receiver binding is a
recognized model client; a caller parameter, custom alternative or pre-existing object member prevents that claim.

An OpenAI-compatible client whose base URL is selected at runtime establishes a hand-written agent's model boundary,
but not the service provider or model identity. The scan now reports the enclosing agent and a source-located unresolved
provider boundary instead of either labeling the endpoint OpenAI or silently classifying the adapter not applicable.

The defect was found by the independently selected `tubemind` holdout, whose shared model helper contains two
function-scoped compatible-client imports and runtime-selected endpoints. The exact positive is pinned as a
source-cited regression. The proposed negative, `SNAGLINE`, contained executable offline agent demonstrations and was
therefore not a valid negative control; Orchescope correctly detected that source, and it is not added to the corpus.
Both exposed source lineages are permanently ineligible as future blind holdouts.

The full pinned corpus exposed the same identity boundary in CrewAI. Its AI-Mind tool sends an OpenAI-compatible call
to the literal `https://mdb.ai/` endpoint with a runtime-selected model, so the scan retains the enclosing agent but no
longer labels the provider OpenAI. Its release-note helper accepts a caller-supplied client on one path, so the scan
does not derive an exact agent, provider, model, prompt relation or timeout finding from the other path's local OpenAI
construction. The committed expectation records those source-reviewed removals and retains the unresolved inputs.

### Object callables own the effects in their bodies

JavaScript and TypeScript object shorthand methods and function-valued properties now retain the smallest callable
name that owns their body, even when the object literal is nested inside another call. External services, caller
relations, evidence, findings and exports therefore agree on the method that performs an effect. A genuine top-level
call remains module scope. A call inside a callable with no authoritative source name receives an explicit refusal
instead of borrowing module or surrounding-function ownership. An opaque wrapper does not lend its result variable to
a callable argument; only the method name the source establishes is retained when it is otherwise unique.

Callable paths distinguish nested object members, getters and setters, static and instance class methods, nested
classes and lexically distinct local bindings. Array positions, repeated ownerless literals and duplicate body-local
names are refused because line numbers, source order and generated labels are not semantic identity. Dynamic computed
callable keys remain unsupported, while the key expression itself stays in the surrounding evaluation scope because
that code executes when the object or class is created. Static class initializers retain that surrounding evaluation
scope; instance initializers and anonymous callbacks do not borrow a class, surrounding function or module as a
callable owner. The same refusal boundary applies to HTTP and model calls, datastores, queues, retry helpers and
deployment bindings.

Retry-loop analysis stays inside the loop's callable scope: a nested function or object method declared within a loop
does not execute merely because its definition is constructed there. Conflicting calls summarized by one service or
relation retain both read and write permissions while their effect becomes `unknown`; conflicting request methods
become `mixed`. An unsettled method cannot inherit a definite POST or read-only polarity from a sibling call.

The defect was found by the independently selected `agentgauge` negative control. Its pricing update request executes
inside a command object's `run` method, while the frozen candidate created a module-scope component and propagated that
unsupported identity through its graph, finding and Mermaid export. The independently selected positive,
`CrossDiscipline-Research-Agent`, remained an honest unsupported hand-written application with no guessed runtime.
Both exact targets contribute distinct source-cited regression inputs, and both source lineages are permanently
ineligible as future blind holdouts.

### Agent identities follow exact source bindings and lexical scope

OpenAI Agents SDK components now use a stable source binding inside the function or method that constructs them.
Explicit runtime names remain display and reconciliation facts; they no longer merge unrelated Agent instances from
different functions, tests or local variables into one graph component. Tool, handoff, model, guardrail and prompt
relations resolve inside that same lexical scope and require the referenced construction to precede the relation.
Distinct instances that share a runtime name therefore remain distinct, while a proven assignment of an Agent to
itself can still produce a self-handoff.

A surrounding result variable authorizes Agent identity only when its direct initializer is the matched constructor.
An Agent nested inside `Runner.run(...)`, an item wrapper or another Agent cannot borrow the outer result binding.
Repeated ownerless constructions with no stable source distinction are explicit topology refusals. Python source facts
that retain only a chained call such as `Agent(...).clone(...)` likewise produce a source-located refusal: clone
arguments cannot be substituted for constructor arguments or used to invent an Agent name, tool population or
relation. Direct `Agent(...)` and the separately established `Agent.create(...)` form remain supported.

This materially changes the pinned OpenAI Agents Python projection. Previously 1,681 construction sites collapsed into
615 source components; the corrected projection retains 1,638 one-construction Agent components, refuses 42 ambiguous
ownerless or reassigned sites and one constructor chain, and preserves only source-scoped tool, handoff, model,
guardrail and prompt relations. The merged high-fanout `inventory` and `sdk-root` topology claim disappears because
those names belonged to many distinct constructions rather than two coordinators.

### Finding identity and evidence populations are stable and reviewable

Finding identifiers are derived from rule, polarity, semantic situation and subject rather than list order, prose,
severity or time. Adding an unrelated finding or reordering evidence no longer changes an existing identifier. Goals
and comparisons therefore keep continuity when another finding appears.

Every material finding clause is bound to evidence. Grouped findings record the complete population they summarize,
the sample they display and what was withheld. Strengths name their evidence population and sample size; missing or
dangling evidence causes a bounded refusal instead of a broader claim. Report exports retain every mandatory citation
and its derivation inputs before optional evidence.

Topology-dependent absence claims now require a complete topology population. Conditional routes, prompt uses,
computed tools, dynamic models and applicable adapters that found nothing remain explicit refusals. An incomplete
population cannot produce reachability or acyclic strengths merely because unresolved paths were omitted.

### Provider, model, prompt and framework identities use source authority

Provider recognition is qualified by the imported runtime symbol and rejects wrong packages, type-only imports,
shadows and unresolved lookalikes. Configurable model and search paths retain bounded static alternatives, distinguish
defaults from runtime selections and keep provider-library defaults separate from explicit endpoints. Direct
`ChatOpenAI` construction, LangChain v1 `create_agent`, its model, tools and dynamic prompt boundary now have dedicated
source readers.

Prompt discovery binds text to semantic producer inputs rather than nearby prose. Formal Python module, class, function
and method documentation strings cannot become executable prompt evidence. Source-settled prompt assembly preserves
its lexical owner and refuses computed or provider-unqualified values instead of selecting an incidental string.

### Blind evaluation and corpus gates cannot rewrite semantic acceptance

The release boundary now requires an independent positive holdout and agent-adjacent negative selected after the
candidate freezes, exhaustive exclusion before acquisition, an installed-tarball measurement, preserved raw evidence,
and a different unseen pair after any fix. Completed evaluations permanently retire both selected source lineages.

Pinned corpus entries can carry non-recordable semantic acceptance for exact identities, source-cited relations,
producer applicability, topology refusals, finding polarity and strength counts. Recording can update aggregate
observations but cannot teach the gate to accept a same-sized semantic substitution. Selected required repositories are
also pinned by normalized archive-tree and licence digests.

## 0.9.0

Released 2026-08-22 from npm as `orchescope@0.9.0`, published locally with `npm publish --no-provenance`,
so this release carries no registry attestation. `pnpm package` built a tarball byte identical to the one on the
registry, which was checked by downloading the published package and comparing:

```
sha256  fa79ac36990e6e4c6ba023ab5cc35e3c3334796bd605e86b4c26a6a507701307
```

Installed from the registry, the binary reports `0.9.0` and `orchescope doctor` passes every required check.

Where breadth comes from as agent systems proliferate, asked with measurements and answered in accepted
decisions: the fact model rather than the adapter count, provenance rather than a confidence band, a corpus
gate that holds invariants a recording cannot rewrite, and a manifest role that separates a consumed system
from the repository implementing it. The first CrewAI run anywhere in this corpus first exposed an ambiguous
name join and now proves three source-qualified joins against the exact pinned checkout. Five live precision
failures found by the corpus on the first run of the invariants written to catch them, all of them one defect.
Every location now says which revision of which file it was read from, and every version 3 manifest citation
is checked against the repository rather than taken. Three real repositories now run in the required corpus
without being vendored. Four interfaces with no producer, three deleted and one given the process it was written
for. Four measurements that ended in a decline remain recorded where the next reader will find them, and every
published bound that moved has its own falsifier.
Published document changes: manifest advances from version 1 through version 2 component details to version
3 self-pinning source citations; system
graph v1 adds optional observed source identity, repository URL and Git-derived repository subroot fields;
trace bundle v1 preserves optional per-span resource attributes and recognises MCP client requests; report v1
extends missing-attribute coverage with source-identity purposes and refusal reasons; federation v1 qualifies
local component references by canonical repository URL and full revision. The additions remain readable by
existing version 1 readers.

### Three CrewAI roles select their declarations by observed source, not by their shared names

The marketing example executes three agents whose role strings each occur in three declarations across the
pinned repository. Before source identity, the run produced three runtime-only agents, three ambiguous names,
zero of 90 exercised components and a coverage sample missing `code.file.path` three times. Its four findings
included the ambiguity. A role cannot select among those declarations honestly.

A bounded integration at the CrewAI instrumentation boundary observes the immediate Python caller when each
real Agent is constructed and attaches that identity only when the same object executes. The span carries an
absolute code path, line, function, canonical repository URL and full clean-checkout revision. Each field keeps
the exact span or resource attribute that supplied it. Reconciliation accepts the path only inside the scanned
root, verifies the repository and revision independently, and requires the line to fall in the declared range.
Conflicts, generated output without a unique source mapping, incomplete coordinates and stale revisions become
named coverage refusals rather than weaker joins.

On the exact pinned CrewAI, CrewAI Tools, OpenInference and OpenTelemetry package versions, the same six-span
run now records three of 90 exercised components, all three by `code_location`, with zero name-only joins,
zero runtime-only agents, zero ambiguous names and no missing source attributes. Agent declarations remain 81,
relation joins remain zero of 16 and the remaining three findings describe the unchanged topology and coverage
gaps. Resource attributes stay attached to the span that carried them, so one process cannot donate a revision
to another span. Declaration-shaped endpoint attributes remain unable to prove their own runtime relation.

### One upstream MCP example pins both repositories it actually runs

The multi-repository boundary previously had a source primitive and no real system to test it against. The
corpus now pins the OpenAI Agents JavaScript repository's own filesystem example together with the separate
MCP Servers repository at the peeled commit for filesystem server release 2026.1.14. The client package and
lock select that exact release, the example launches its entry point over stdio, and both repositories are
MIT. This is one upstream-authored integration rather than two projects chosen because their APIs fit.

The second checkout is audited at `src/filesystem`, the independently published package inside its monorepo.
It contributes 1 implemented MCP server, 14 tools and 14 `provides_tool` relations across 12 supported files.
The corpus definition repeats both canonical URLs and full revisions, states why they form one system and
pre-registers the runtime falsifier. A cross-repository join needs a successful `tools/call` whose W3C trace
context crosses the real stdio boundary and whose two endpoints each carry source identity for their own
checkout. The corpus list only locates source; it cannot prove that the request crossed.

### One real stdio request joins declarations in two repositories

The pinned OpenAI Agents filesystem example now runs with a deterministic model against the actual compiled
filesystem server checkout. One successful `read_text_file` request carries W3C context through MCP `_meta`.
The client request maps to `examples/mcp/filesystem-example.ts:8` at the client revision, and the server child
maps through its source map to `src/filesystem/index.ts:206` at the server revision. Neither coordinate comes
from the corpus list, package resolution, working directory or component name.

Federation scans the repositories separately, retaining 668 client components and 15 server components under
their own graph identities. The six-span run produces three code-location component joins and one observed
`calls_tool` relation from the client repository's MCP server declaration to the server repository's
`read_text_file` declaration. A second client instrumentation span has no source identity and is refused; it
cannot contribute a weaker name join.

The new `FederationReport` version 1 embeds each graph once and qualifies every accepted component reference
with canonical repository URL and full revision. The command line and MCP surfaces bound roots, runs, joins and
refusal samples. Wrong revisions, dirty graphs, one-sided traces, missing parent context and identical local
identities in different repositories are explicit negative cases. Operator roots locate work and never become
observed evidence.

On the pinned acceptance run the complete report is 1,967,101 JSON bytes and 201,901 bytes compressed; the
bounded command line projection is 4,108 bytes. No persistence table or stored artifact is added. Measured from
the last pre-federation commit, the command line bundle grows 33,221 bytes, the tarball grows 6,589 bytes and the
26,096 byte injected shim does not move. The exercised corpus case takes 7.65 seconds with a rebuilt shared Node
environment and 4.83 seconds warm. The tarball still installs and audits TypeScript and Python successfully.

### Three source files git read as binary, one of them where every component identity is minted

A single literal NUL byte makes git treat a file as binary, and a binary file produces no diff. Three held
seven between them: `packages/domain/src/identity.ts`, which mints the key of every component identity and
the identifier of every relation, `packages/graph/src/graph-builder.ts`, which is the only place component
identifiers are assigned, and `packages/findings/src/grouping.ts`. Every change any of them has ever
received went in without a reviewable diff, including the ones in this release.

The byte itself is right. It is the separator in a composite key, and a NUL is the correct choice precisely
because no identity can contain one. What was wrong is writing it as a raw byte rather than as `\u0000`,
which is the identical string at run time and leaves the file as text. No key changes, and all nineteen
measurable corpus entries are byte identical.

**And the index is now asked.** Every tracked text file is checked for a literal NUL, so this covers a file
that does not exist yet rather than the three that did. It is the hazard that had already produced one
binary source file before this and would have gone on producing them silently.

### Two corpus runs at once measure each other, and now one of them refuses

Every pinned entry is scanned in place: stored state is cleared inside the checkout before the audit, and
the shapes crossed with a repository that is not an agent system are written into it and removed after. So
two runs at once measure each other, and it does not fail loudly on its own. A full run overlapping the
offline one the gate performs reported `mcp_server:docs` declared by an injection that declares no server,
because the other run's `.mcp.json` was on disk at the time, and reported a second shape as never reaching a
reader because the other run had already taken it away. Both read as this build being wrong about a
repository, which is the one thing a corpus exists not to say by accident.

A run takes a lock naming the process holding it and a second one refuses with that name, rather than
producing a measurement nobody can tell from a regression. A lock whose process is gone is taken over, so an
interrupted run does not leave a file to be deleted by hand.

### Two node types the JavaScript reader answered to and the parser never emits

`StaticMemberExpression` and `StringLiteral` were checked at seven sites: in the literal reader, in the
member path walk, in the callee path, in two argument switches, in the text visitor and in the list of
initialisers that give a definition its name. `parseSync` returns an ESTree shaped tree, where a string, a
number, a boolean, `null` and a regular expression are all `Literal`, and both of those names belong to a
different parser.

Counted under the pinned `oxc-parser` across **5,123** JavaScript and TypeScript files in the corpus:
`MemberExpression` **349,683**, `Literal` **367,281**, and each of those two names **0**. This is the same
measurement that justified deleting the `ComputedMemberExpression` branch, and it was left alone then
rather than widening a defect fix into a sweep. Every corpus entry is byte identical without them.

### A cache with no producer, given the one it was written for

`inMemoryFactCache`, `cacheKey` and `ANALYZER_VERSION` had no caller anywhere. A scan accepted an optional
`cache` and `analyzeFileSet` read it, and nothing constructed one, so the whole path was assembled up to the
point where something would have to use it. `knip` misses it for the same reason it missed two evidence
builders: it leaves through the package entry point, and entry exports are not checked. That is a gate
opening onto nothing, which is what
[ADR 0002](docs/architecture/adr/0002-deterministic-analysis.md) was written about.

**The producer is `orchescope mcp serve`.** A command line audit parses a repository once and exits, so a
cache there is filled and thrown away. The MCP server is a process a coding agent holds open while it
works, and the loop this repository documents is to scan, change something and scan again. Parsing is what
the second scan spends. Measured on the pinned checkouts, in one process:

| checkout | files | first scan | second scan |
| --- | --- | --- | --- |
| `open-agent-platform` | 203 | 229ms | **27ms** |
| `crewai` | 2,027 | 4.8s | **375ms** |
| `pydantic-ai` | 1,807 | 5.0s | **352ms** |

**And it is bounded, which it was not.** A server watching a repository being edited would have kept a copy
of every version of every file it ever parsed, which is a queue with no ceiling wearing a cache's name. The
capacity is the caller's `analysis.maxFiles`, the same number that bounds a traversal, so one whole scan
always fits and nothing older than one scan survives. An edit reparses the one file that changed and serves
the rest, and the revision before it does not stay beside it.

### Two decisions accepted, each on the measurement it named in advance

[ADR 0004](docs/architecture/adr/0004-provenance-not-confidence.md) and
[ADR 0005](docs/architecture/adr/0005-corpus-invariants.md) were proposed with the measurement that would
reverse each of them written down first. Both were run. Neither reversed.

**0004 was strengthened by five failures it did not know about.** Its claim is that recognition is widened
by provenance and never by lowering a confidence band, on the evidence that all four recorded confidently
wrong answers were identity or provenance errors. The generated negatives then found five more, and all
five were the same mechanism failing at the one place it could not see: `ConfigOrigin` records why a
document was opened, and the fixed list of paths collapsed three reasons into one value. The fix is data,
no band would have changed any of the five in either direction, and the amendment it asks of the adapter
guide has landed.

**0005's falsifier is 0.** Its dependency property would have been demoted with more than one exception on
the corpus once the fact model work landed, and the count of components attributed to a framework adapter
whose packages the repository does not use and that do not carry `developer_tooling` is zero. Every adopted
check is built. The dependency property was measured and folded into the generated negative family rather
than kept as a separate family, and what changed about it is recorded rather than quietly dropped:
`--record` does overwrite the boolean that record said it could not, and `dependencyEvidence` cannot answer
the property it was going to be wired for.

### Where breadth comes from as agent systems proliferate, asked and answered with measurements

Thirteen hand written per framework readers produce the declared half of this build's join, 5,493 lines
against 42,077 that know no framework name, and the question of what happens as the field grows had never
been written down. [docs/architecture/mapping-architecture.md](docs/architecture/mapping-architecture.md)
asks it, measures six directions against this repository, and stages the answer. Four decisions follow from
it, recorded separately so each can be refused on its own evidence:
[ADR 0003](docs/architecture/adr/0003-fact-model-breadth.md) on the fact model as the breadth lever,
[ADR 0004](docs/architecture/adr/0004-provenance-not-confidence.md) on widening by provenance rather than by
a confidence band, and [ADR 0005](docs/architecture/adr/0005-corpus-invariants.md) on a corpus gate that
holds invariants, and [ADR 0006](docs/architecture/adr/0006-manifest-component-details.md) on manifest
ownership semantics.

**Four things this repository recorded about itself were close to true and not true.** The corpus reported
seven adapter gaps and one is an adapter gap: two are false, four are correct refusals. The containment
boundary for framework knowledge is `packages/discovery`, not `packages/discovery/src/adapters`, and the
fifteen lines that leaked out are patterns no convention expresses. Confidence is read for severity and is
read nowhere that decides identity. And the corpus is 49.8% of the cost of a framework while an expectation
has no polarity: `crewai-examples-exercised` records `exercisedComponents: 0`, zero is the fix, and the only
place that sentence existed was this file.

**The most attractive direction was tested rather than argued, and it failed.** A convention driven reader
was implemented against this repository's own `analyzeFileSet` and run over the pinned negatives. On
`open-agent-platform`, pinned `not_agent_system` at a ceiling of 26 components, the import recognizer fires
40 times and the known keys recognizer twice, and either one flips `agentSystemDetected` and takes the
entry with it. A band cannot stop it, because nothing that decides identity reads one.

Every number in the document was derived against the pinned corpus with the command that produces it beside
it, so a reader who distrusts a figure can run it instead of taking it.

### A list of six inside the test that guards the corpus, where the set is eight

`tests/e2e/corpus.test.ts` checked that every framework adapter this repository claims is exercised by at
least one pinned repository, against a hand written array of six. `adapter:mcp` and `adapter:search-index`
were not in it. Both happen to be covered, so nothing failed, which is exactly the failure: a list written
by hand covers what its author remembered on the day, and an adapter nobody listed can go quiet without the
check that exists to notice noticing.

It is derived from `DEFAULT_ADAPTERS` now, by whether the adapter declares the packages it reads, which is
the same field discovery compares against what a repository imports. Eight today, and a fourteenth reader is
covered on the day it declares one rather than on the day somebody remembers this file. That is the pattern
`rule-input-producers.test.ts` and `goal-eligible-rules.test.ts` exist to set, and this was the last hand
written list of its kind sitting inside the corpus gate.

### The documented adapter order, which was missing four of the thirteen

`docs/architecture/discovery-lifecycle.md` draws the order adapters run in, and it drew nine:
`workers-bindings`, `pydantic-ai`, `search-index` and `implementation-reach` were not in it. Order is the
document's own point, because a relation can only be drawn once both endpoints exist, so a reader working
out where to register a new adapter was reading a picture with four missing from it.

It is derived now, from `DEFAULT_ADAPTERS`, in the same check that holds the adapter guide to the interface.
A reordering or a fourteenth reader fails there rather than going unnoticed.

### The adapter guide, which did not compile against the interface it documents

The page an author copies to write a reader declared an `ecosystem` field that does not exist, omitted
`packages` entirely, returned `filesInspected: files.size` where the type is a list of paths, and imported
three helpers from a module that does not export them. Every one of those is a compile error in an adapter
written by following it, and the page had no way to fail.

Both halves are checked now, and both derive their expectation from the build. The fields the example
declares have to be the fields a registered adapter declares, so a fourteenth one fails here on the day it
is added rather than on the day somebody rereads the page. Every value import in every TypeScript block has
to name a binding the module it cites actually exports.

**And the confidence section says what a band is for and what it is not for**, which
[ADR 0004](docs/architecture/adr/0004-provenance-not-confidence.md) requires of it. It is an input to
severity: `MIN_CONFIDENCE_BY_SEVERITY` caps how severe a finding may be given the evidence under it. It is
not read to decide identity, detection or a reconciliation match, `mergeConfidence` is `Math.max`, and every
one of the four confidently wrong answers on record was an identity or provenance error that no scalar
expresses. An author following the old advice believed a low band was holding their component to a standard
that nothing applies.

### A manifest that can be wrong, and is told so

The manifest is a first class input and the documented first step for a system no adapter reads, and it is
the one input nothing checked against the repository it describes. `definedIn: src/does-not-exist.rb,
definedAtLine: 4242` was accepted, and the component appeared in the graph with a location a reader could
click. Passing the schema says a document is well formed. It says nothing about whether any of it is true.

**Seven claims are now refuted.** A `definedIn` that names no file the scan found. A line beyond what the
file is long enough to hold. A `runtimeName` carrying a placeholder,
which is a name no run reports and which the CrewAI reader already refuses in a declared role. And an edge
endpoint naming nothing this manifest declares and nothing any other adapter found, which used to be
skipped in silence, so a typo in a relation vanished without a word. A manifest that fails any of them is
reported as a failed adapter run naming each claim, and what it got right is still read: one bad citation
among eighteen does not lose the seventeen. Manifest version 2 adds the fifth: `details.for` must agree
with the component `kind`, and invalid details do not enter the graph.

Manifest version 3 adds the remaining two. `definedIn`, `definedAtLine` and `definedFileHash` are one closed
citation shape. Discovery snapshots only those requested files under the traversal ceilings. The adapter
verifies the scanned digest and verifies that the cited UTF-8 line contains the component name or its
`runtimeName`. A stale digest or wrong line fails the adapter, and that source location stays out of the
graph while the component's other valid declaration facts remain. Version 1 and version 2 keep separate
closed readers and acquire no version 3 meaning.

**The traversal had to start recording what it walked.** `collectFiles` drops every language no parser
reads, which is the right set for parsing and the wrong one for asking whether a path is there, and the one
input that exists precisely for the languages this build cannot parse is the manifest. It now carries the
paths as well, so `definedIn: src/orchestrator.rb` is answerable. Version 3 discovery opens only the bounded
cited set and hands line and digest facts to the adapter, which still opens nothing.

**And a location this build was inventing is gone.** A component with `definedIn` and no `definedAtLine`
recorded line 1, which is a claim the manifest never made and a link that lands on the imports. There is no
way to write "somewhere in this file" in a source location, so that citation is refused rather than
completed, and nothing fabricated reaches the graph.

**This repository's own reference manifest failed the standard it documents.** 16 of its 18 components cited
line 1, and for 4 of them the cited file does not contain the component's name anywhere: `account-worker`
and `inventory-worker` are declared in `src/agents/definitions.ts` and cited `src/agents/workers.ts`, and
`demo-small` and `demo-large` are named in `src/main.ts` and cited `src/model.ts`. Every one of the 18 now
cites a line that contains the name it declares. All 18 now use version 3 and pin those 11 files by digest.
The engine catches both classes: a source edit reports the declaration as stale, and a current digest with
the name moved off the cited line reports the incorrect line.

The 18 hashes grow the reference manifest from 7,568 to 9,116 bytes, 20.5%. Ten copied-repository audits
measured version 2 discovery at 37.0ms mean and 37ms median, and version 3 at 38.4ms mean and 38ms median.
The bounded verification adds 1.4ms mean and 1ms median on the demonstration.

**The bound reproduced, and manifest version 2 moves exactly the answer it names.** The honest one
component version 1 manifest for `open-agent-platform` still flips `agentSystemDetected` from false to true
at 26 components becoming 27. [ADR 0006](docs/architecture/adr/0006-manifest-component-details.md) gives
`ManifestComponent` the same kind-specific `details` an adapter writes. With `role: consumed`, the same
repository reads false at 27 components and the exported graph still contains one `mcp_server`, its details
and its source citation. Changing only the role to `implemented` reads true, and version 1 remains readable
with its established true meaning. Detection stops confusing a repository that consumes a system with one
that implements it, without hiding the consumed component from a real agent topology.

### Three real repositories enter the required gate without being vendored

Required CI measured only the two local corpus entries. Eighteen static third-party entries stayed in the
manual live job because committing their source would cross the licence boundary, and the required gate
therefore caught almost no reader drift against source the reader author did not write.

The new required mode keeps the local entries and adds `open-agent-platform`, `openai-cs-agents-demo` and
`vercel-ai-chatbot` from their exact full-commit archives. The first is the strongest real client-only
negative and runs all 11 lookalike injections. The other two are compact applications contributing OpenAI
Agents, Vercel AI SDK, implementation-reach, effects and prompt facts. Their pristine clone footprints total
5,605,263 bytes. The archives total 1,445,736 compressed bytes and 3,876,651 source bytes across 453 files,
with about 7.6 seconds of measured audit work.

The gzip file is deliberately not the pin. GitHub guarantees the extracted contents of a full commit archive
while allowing compression and generated root names to change, and those outer byte counts changed during this
work while the source did not. Each corpus entry pins a normalized SHA-256 over every relative path,
executable bit and file byte, then separately pins its licence file. The reader caps compressed and expanded
bytes, entry count and individual file bytes; validates tar checksums and the exact commit comment; and refuses
links, devices, duplicate paths, traversal, extra roots and unsupported metadata before writing a checkout.

The production command reproduces all five selected expectations: 5 matched, 0 differing, 0 not measured and
0 skipped, with 22 of 22 injected shapes held. Two final runs took 17.09 and 16.05 seconds on the measured
machine, a mean of 16.57 seconds. It reports 119 third-party components and 91 relations under their existing
contracts. The offline two-entry command stays network free, the full corpus keeps its shallow Git checkouts,
no expectation moves and no third-party source enters the package or a CI artifact.

### A location that says which revision of the file it was read from

`SourceLocation` and `ConfigLocation` have carried an optional `fileHash` since they were written, described
as the digest that makes staleness detectable, and it was produced **0 times**. So every location this build
has ever emitted named a path and a line and said nothing about which revision of that file it was true of.
A stored graph, an exported bundle and a hand written manifest were all unfalsifiable the moment the working
tree moved.

The CrewAI join made that sharper rather than softer. 39 agents in the pinned examples repository now carry
the document entry that declares them **and** the call that builds them, two files with two lifetimes, and a
component whose declaration moved in one of them looked exactly like one that did not.

**It is written now, in one place.** The graph builder is where every draft from thirteen adapters and the
manifest reader meets, so it is where the digest is stamped; a stamp applied per producer is one a
fourteenth would have to remember. Discovery hands it the digest of every file it parsed, which the analyser
already computes, and of every configuration document it opened, which now records the digest of the bytes
it was parsed from beside their length.

**Evidence carries the same location, and stamping it re-mints the identifier.** That is the identifier
becoming correct rather than changing: an evidence record's identifier is the digest of its content, and its
content now includes which revision the span was read from. Two scans of one revision still produce one
record. Two scans across an edit produce two, which is the entire reason for writing the digest.

Measured over the nineteen pinned repositories the required corpus measures: **29,965 of 29,965 locations
carry the digest of the file they point into**, against 0 before. No expectation moves, because an
expectation records counts and kinds rather than locations. The bundles grow by about 15%, which is
pydantic-ai's 4,077 KB becoming 4,690 KB: 6,933 locations over 284 distinct files, so each digest is
repeated about twenty four times. Recording each file once is a change to a published document and is worth
deciding on its own evidence rather than assuming here.

### Per attribute provenance on every observed component and relation

`graph.node.parent_id` is written by the CrewAI instrumentor on every agent span after the first, and on
the pinned marketing crew its values draw exactly the sequence the crew declares. They are not a sequence
any run took: the instrumentor finds the agent whose task is running in `crew.agents` and returns the role
of the entry before it, so the value is a position in a declared list evaluated at span time. Reading it
would have moved `exercisedEdges` off zero and filled `runtime.joined`, which is the shape of a fix, and
every edge it added would have been a declaration this build already reads from source, sent out through
the process being audited and reported back.

The trace topology now records the exact inputs behind every identity and relation. A component keeps the
attributes that produced its kind, name and code location, with an explicit span-name fallback where no
attribute did. A relation keeps its trigger apart from the attributes naming its two endpoints. Provenance
survives aggregation when more than one span reports the same component or relation.

**The anti circularity check is the property rather than a named list.** When a declared edge's supposed
runtime trigger is wholly one of its endpoint attributes, and no span field says the relation happened,
reconciliation does not mark the edge exercised. The same declared edge from real parent-span nesting is
retained. `graph.node.parent_id` is the reproducer, not an entry in `REDERIVABLE_ATTRIBUTES`, and the table
is deleted.

**A silent zero now names what is missing.** Reconciliation coverage reports `code.file.path` and the
observed component count that lacked it. The CrewAI run says three observed components lacked the attribute,
beside zero code location joins, zero exercised components and the same three ambiguous names. Across all
eight exercised entries the runs still join **21 components, 20 of them on a name alone, and 6 relations**.
The multi repository boundary therefore has not moved: `byCodeLocation` remains zero on all eight, and no
pinned entry crosses repository roots.

### Three evidence kinds nothing writes, and two builders that were waiting for a caller

`Evidence` carries ten kinds. Seven are written. `dependency` and `scenario_outcome` each had a builder in
`packages/domain/src/evidence.ts` and no caller anywhere, 0 of 20,873 records across the pinned corpus, and
`model_interpretation` has had none since [ADR 0002](docs/architecture/adr/0002-deterministic-analysis.md)
removed the path that would have produced it. Neither builder was reported by `knip`, because both leave
through the package entry point and entry exports are not checked.

`dependencyEvidence` was to be wired rather than deleted, because the dependency property in
[ADR 0005](docs/architecture/adr/0005-corpus-invariants.md) was to be answered from the bundle with it.
Measured, it cannot be. It records that a manifest declares a package, and a manifest declaration answers
that question on **12 of the 27 entries**: on 15 a framework adapter's packages are used and named in no
manifest this build reads, and 9 of those declare nothing at all, because `readManifests` reads the
repository root and they are monorepos or per directory applications. `crewai-examples` is the sharpest
case. It has no root manifest of any kind, `crewai` is answered there entirely by imports, and it holds 18
of the 21 components in this corpus declared only by a configuration document, which is exactly the
population that evidence would have been worth having on. It would have fired on 1 of those 21.

So both builders are deleted rather than wired. What is left is three terms in a published contract that
nothing produces, which is a true statement about this build and is recorded as one: narrowing the
`Evidence` union to match moves a published document version, and that is a decision on its own evidence
rather than a tidy up attached to this one.

### The dependency property, and what it turned out to be

[ADR 0005](docs/architecture/adr/0005-corpus-invariants.md) proposes a property that holds with no
expectation behind it: *a component attributed to an adapter whose declared packages the repository does
not use must carry `details.role: 'developer_tooling'` and must not count toward `agentSystemDetected`.*
Both recorded precision failures were exactly that shape, an adapter reaching a repository through a
configuration door rather than through a dependency, so the property is a check on the two doors that have
ever leaked.

**Checked over the pinned corpus it has nothing to check.** At most one component across all twenty seven
entries satisfies its antecedent, and none at all under the predicate this build uses to decide whether an
adapter runs. Where it has a population is a repository that declares one ordinary web framework and holds
one of the shapes that have fooled this build, which is what the lookalike table is, so that is where the
property is now asserted: every component attributed to any adapter that claims a package has to say whose
it is, and the repository has to stay not an agent system.

**The adapter set is derived rather than written down.** It is `DEFAULT_ADAPTERS` filtered by whether the
adapter claims a package, which is what covers a fourteenth reader on the day it declares its `packages`
rather than on the day somebody remembers. It is eight today, and the check says so out loud so that a
build where it silently became fewer fails rather than passes quietly.

The table moved to `packages/testkit` so the corpus harness and these tests read the same rows. What runs
in the gate a change has to pass is the half that needs no checkout and no network; the corpus writes the
same rows into five real repositories.

**A name a framework owns outright is deliberately not in the table.** `crew.jsonc` is CrewAI's own, its
generator writes one and its `pyproject.toml` names it, and a repository holding one is declaring a crew
whatever else it depends on. Injected into a repository depending on express it declares two agents and
reports an agent system, which is the property being violated by an answer that is correct. That is the
line the table is drawn along: these are the names that belong to nobody.

### Five shapes the fixed list let through, found by the corpus on its first run

The generated negatives were built to catch a precision failure before a field report does. On the first
run they caught five, all of them the same defect, and all of them live in this build until now.

`ConfigOrigin` records why a document was opened, and it is the mechanism five of the six gates that have
ever held precision are built on. The ten paths this build opens on every scan defeated it, because being
on that list was recorded as one reason when it is three. `.mcp.json` and its four siblings are there
because a coding agent writes them. `.orchescope/manifest.yaml` is there because this build writes it.
`agents.yaml`, `config/agents.yaml` and `crew.jsonc` are there because CrewAI's layout puts agents there.
All ten arrived as `known_path`, and every reader that recognised a key in any of them read it.

**So where a document sat decided who could read it.** A roster of account executives under
`deploy/agents.yaml`, found by the traversal, is declined in a repository that declares no CrewAI, which is
the fix on record for the second recorded failure. The same roster at the root, or under `config/`, was
read: two agents declared, and a repository depending on express and nothing else reported as a detected
agent system. An `mcpServers` key is declined under `deploy/agents.yaml` and was read at the root, under
`config/`, and out of this build's own manifest, each time as a server the repository connects to.

**The origin now travels with the path**, so the fixed list says which reader each name was collected for.
`agent_client` is a coding agent's or an editor's own configuration, `agent_declaration` is a document a
framework's layout puts agents in wherever it sits, `orchescope_manifest` is this build's own, and
`platform_manifest` is unchanged. Neither adapter needed a new gate: the MCP adapter already asked whether
it was entitled to read a document by its content, and the CrewAI adapter already required the framework
for a document found by name. Both were being handed the wrong answer.

Two exemptions went with it. The CrewAI gate no longer excuses the two paths read before the traversal,
which is the whole of that widening, and its `appliesTo` no longer offers an agents document a door that
the gate would close anyway. A server declared in configuration is now always a developer's own tooling,
because every document this adapter may read by content is a coding agent's configuration; the 57
components in this corpus that a repository genuinely connects to are all read from the source that
constructs the client, and none has ever come from a configuration file.

**Measured across the pinned repositories: nothing moves.** All nineteen measurable entries are byte
identical, `gpt-researcher` still declares the one MCP server it configures for a coding agent, and
`crewai-examples` still reads all twenty of its packaged agents documents, because that repository declares
CrewAI and always did. What moves is eleven injected shapes across every repository pinned as not an agent
system, six of which held before and five of which did not.

### A corpus entry that holds an invariant instead of a number

Every assertion this corpus makes is a number a scan produced, and `--record` writes all of them. That is
the wrong instrument for a precision failure, because a precision failure arrives as a repository nobody
pinned. Both of the ones on record were found somewhere else: the `.mcp.json` one by a sweep across thirty
odd real repositories, and the `agents.yaml` one by two fixture repositories written by hand. No entry in
this corpus held either shape, and the two fixtures cost a repository each.

**Every repository pinned as not an agent system is now crossed with the shapes that have fooled this
build.** A `.mcp.json` naming one server, a monitoring inventory under `agents.yaml`, a roster of account
executives carrying a role and a goal, hosts under a `servers` key, an `mcpServers` key, a Workers
deployment manifest. Each is written into the checkout, the repository is scanned again, and the file is
removed. What is asserted is the invariant: the repository stays not an agent system, and every component
of an agent system kind carries the role saying whose it is.

Nothing is recorded, so there is nothing for a reviewer to wave through and nothing for `--record` to
rewrite, and a broken invariant fails a recording run as surely as a checking one. Adding a shape is one
row and it applies to every negative at once, so this grows with the failure log rather than with the
number of readers, and it covers readers that do not exist yet.

**A row states the outcome it expects rather than leaving it as a disjunction.** "Declines or carries the
role" is satisfied by a reader that has stopped reading the document altogether, and a row whose reader
went quiet is a row that tests nothing. For the same reason the injected scan has to differ from the base
scan somewhere: a shape a `.gitignore` swallowed would otherwise pass every assertion by not being there.
That is the check that says `.orchescope/manifest.yaml` arrived through the manifest reader rather than
through the traversal, which never walks that directory.

The kinds that decide detection moved to `packages/domain` beside `partOfAuditedSystem`, because the two
are asked in one breath and a check on what detection can be moved by has to read the set detection
decides with rather than a copy of it.

### What `--record` can rewrite, and the invariant that was waiting on a measurement

[ADR 0005](docs/architecture/adr/0005-corpus-invariants.md) opened on a premise that is not true.
`--record` does not stop at one boolean: an expectation is written whole from the observation, so
`agentSystemDetected` is as rewritable as any count. Flipping `corpus/expected/flask.json` to `true` by
hand and running `node scripts/corpus.mjs --record flask` writes it straight back to `false`, which is the
leaf that record was written to say could not be written.

**What no recording can do is silence the claim, because the claim is not read from the expectation.**
`claimDifference` checks the scan against the `kind` in `corpus.yaml`, and `tests/e2e/corpus.test.ts`
asserts the recorded leaf against that same `kind` out of band. Recorded as detected, `flask` fails the
corpus test with "flask is pinned as not_agent_system and its expectation disagrees". One claim per entry
is held somewhere `--record` does not write. The other 2,468 of the 2,495 leaves are held by a reviewer.

**And the measurement that decides whether the dependency property is an invariant has been run.** It was
waiting on the fact model work, which has now landed, and the criterion is the count of components
attributed to a framework adapter whose packages the repository does not use and that do not carry
`developer_tooling`. **It is 0.** More than one would have demoted the property from an invariant to an
expectation wearing an invariant's name.

The fact model work moved the proxy that record quoted and did not move the answer. Components attributed
to a framework adapter fell from 6,116 to 6,032, the 84 being the CrewAI join folding a declared agent and
the call that builds it into one component: 40 on each `crewai-examples` entry and 4 on `crewai`. The ones
declared only by a configuration document fell from 104 to 21, because 39 agents on each of those two
entries now carry a source location beside their config location. Neither of those is the property. The
property's own count was 1 before and is 1 now under a source import alone, and 0 under `projectUses`,
which is the predicate `appliesTo` itself asks. The one is `mcp_server:gpt-researcher`, which declares
`mcp>=1.9.1` in `requirements.txt`, imports it in no file, and carries `role: developer_tooling`.

**The finding that changes how it gets built is that it has almost no population.** At most one component
across all twenty seven pinned entries satisfies the property's antecedent, and none at all under
`projectUses`. A gate holding it over the pinned corpus alone asserts over an empty set, which is the
shape `rule-input-producers.test.ts` exists to prevent and which that record names two paragraphs before
proposing it. The generated negatives are what give it a population, so the two are one change rather than
two.

### The CrewAI join this build declined to make

`crewai create crew` writes an agent's role into `config/agents.yaml` and selects it with
`Agent(config=self.agents_config['lead_market_analyst'])`, and this build read both halves and joined
neither. The declared entry and the call that builds it were two components, and the adapter carried
forty nine lines saying why: the subscript key and the class attribute's literal were the two steps of that
chain the fact model did not carry. Both are facts now, so the join is made.

Every step of it is syntax. The subscript carries its literal key, the class attribute carries the literal
path, the path resolves against the directory of the file that wrote it, and the key has to be one the
document at that path declares. Where all four hold, the call adds a source location to the agent the
document declared. Where any one fails, the call names itself and stays its own component.

**Measured on `crewai-examples`, and it closes exactly.** That repository writes 71 `Agent(` calls: 49
select a document entry and 22 carry a literal role. Of the 49, **41 resolve and 8 decline**, which is the
simulation this was funded on reproduced to the call. `components.byKind.agent` falls from **121 to 81**.
The arithmetic closes with nothing left over: 78 of those 81 are CrewAI's, and they are 39 agents carrying
both a document entry and a call site, 9 document entries no call selects, and 30 calls with nothing to
join to. 39 plus 9 is the 48 entries the documents declare; 41 plus 30 is the 71 calls. The 8 declines are
the two cases named in advance: five in `screenplay_writer.py`, where `agents_config = yaml.safe_load(file)`
carries no literal because the document is assembled while the program runs, and three in
`email_filter_crew.py`, where the code selects three keys from a document that declares none of them, which
is a defect in that repository and worth reporting rather than papering over.

**The clearest single case is the one that was silently wrong.** `stock_analysis/crew.py` declares
`financial_agent` and `financial_analyst_agent`, and both select `financial_analyst`. Under the enclosing
method name that was two components, one declared agent split in two with nothing recording that it had
been. It is now one agent carrying both call sites.

**And the falsifier held.** `crewai-examples-exercised` still reports **zero exercised components** against
the same three ambiguous names, verbatim, trailing newline and all. `joined` and `joinedOnNameAlone` are
still empty. This is a join between two declarations and it is not a join to a run: the marketing crew's
three roles are still declared three times over, `uniqueCandidate` still returns nothing, and the reconciler
still refuses. A fact that records what the syntax says cannot make the two halves of that join agree, and
that is now a corpus number rather than an argument. `declaredComponents` falls from 130 to 90 with it,
which is the same forty components ceasing to be counted twice.

`crewai` moves by four agents and one more `declaredInTest`. The four are the framework's own CLI template
and its test project, and one of the components that went was named `test_multiple_before_after_kickoff`
after the test function it sat in, which is the enclosing name failing in the open. The extra
`declaredInTest` is `researcher` and `reporting_analyst` in `lib/crewai/tests/`: declared in a document
under `tests/` and built in `test_project.py`, they had no source location before and so were not counted
as declared in a test, which they plainly are.

### A definition with a location and no value in it

`DefinitionFact` recorded a dotted path when the right hand side was a call, through `initializer`, and had
no field for a value at all. So `agents_config = 'config/agents.yaml'` in a `@CrewBase` class, which names
the document every agent in that crew is configured from, was a definition with a location and nothing in
it. JavaScript was worse: `class C { x = 'y' }` produced **no fact of any kind**, in the language where a
field holding a configuration path is how the shape Python writes as a class attribute gets written.

Both are recorded now, as `literals`, under two rules that are the whole of what makes it safe.

**Recorded and never substituted.** "The class body writes this literal to this name at this line" is
unconditionally true. "This name holds this literal where it is read" is not, and `@CrewBase` is the case
that proves it: the decorator replaces the attribute before any method runs. `initializer` stays beside it,
so a rebinding by a call is visible rather than hidden behind a value.

**Every candidate listed, never one.** `a or 'b'` and a conditional expression each bind more than one and
the syntax does not say which is taken, which is the rule `aliasedFrom` already states one field above.

Measured on the pinned repositories. On `crewai-examples`, 21 of 22 `agents_config` definitions carry the
literal, and the twenty second is `screenplay_writer.py:16`, `agents_config = yaml.safe_load(file)`, which
records `initializer: ['yaml','safe_load']` and no literal. That is the refusal working: the document is
read at run time and the syntax says so. In JavaScript the class field branch is new rather than a value
added, and `openai-agents-js` goes from 27,947 definitions to 29,121, so **1,174 class fields that were
recorded nowhere now exist as facts**, 1,483 of its definitions carrying a literal.

Nothing a reader sees moves. All nineteen measurable corpus entries are byte identical, including
`open-agent-platform`, which gains 102 definitions carrying literals and two class fields and still reads
`agentSystemDetected: false` at 26 components. A fact nothing reads yet changes nothing, and that is the
order the two halves have to land in.

### The largest hole in the Python fact model, which is a subscript

The fact model says at `facts.ts:5-12` that it is language neutral, and that this is what lets one adapter
cover a framework in both ecosystems. Run one program through both analysers and it was not.
`Agent(config=agents_config['lead_market_analyst'])` recorded `{"kind":"member","path":[...]}` in TypeScript
and `{"kind":"unknown","nodeType":"subscript"}` in Python. `subscript` is the most common unknown node type
in all seven Python checkouts in the corpus, without exception.

Python now reads it, on the one condition that keeps it a fact rather than a resolution: **the key has to be
a literal.** `x['k']` selects the entry named `k` by the language definition and leaves nothing open. `x[k]`
selects by whatever the name holds when the program runs, and recording the variable's own name there is
precisely the defect this release removed from the JavaScript reader. An f-string key is not a literal
either, and neither is `x[a, b]`, where more than one key is written and taking the first would be a guess.
A chain is walked whole, so `x['a']['b']` keeps both keys rather than losing the inner one.

Measured over three pinned Python repositories, counting every argument and assignment value including
nested ones:

| entry | subscripts reduced to unknown before | after | read |
| --- | --- | --- | --- |
| `crewai-examples` | 165 | 24 | **141, 85%** |
| `open-deep-research` | 48 | 14 | 34, 71% |
| `gpt-researcher` | 183 | 61 | 122, 67% |

The `member` count rises by exactly the number the unknown count falls by on each of the three, so nothing
else moved shape. What did not move is anything a reader can see: all nineteen measurable corpus entries are
byte identical against their committed expectations, because no adapter asks for this path yet. A fact that
records what the syntax says and is read by nobody changes nothing, which is the order these two halves have
to land in.

The two analysers are now checked against each other on this shape. `analysers-agree.test.ts` gains the
literal key pair and the variable key pair, so the parity claim is a test rather than a sentence.

### A property name the source never wrote

`memberPath` walked a `MemberExpression` without reading its `computed` flag. Under `oxc-parser` 0.141 both
`arr.i` and `arr[i]` are a `MemberExpression` whose property is the identifier `i`, so `listeners[i](1)` was
recorded with the callee path `listeners.i` and nothing downstream could tell it from a property the source
actually wrote. A subscript selects by whatever the name holds when the program runs, which the syntax does
not say, and recording the variable's own name as a property name is an inference presented as an
observation, sitting in the fact model rather than in a reader.

**It was latent in the graph and it was not latent in the facts.** Across all twenty seven pinned
repositories not one component, relation, adapter count or coverage claim moves: nineteen measurable entries
are byte identical against their committed expectations. What moves is underneath. Over 5,254 corpus files
the correction removes 206 callee paths, 494 `member` argument facts and 1,621 assignment target segments,
and 374 arguments that carried a fabricated path now record `unknown`, which is what the syntax supports.

**The clearest case is the demonstration system this build ships.** `apps/demo/src/main.ts` writes
`flags.get(flag) ?? process.env[variable]`, and the analyser recorded an environment read named `variable`.
That program has no such variable and never had one; it reads whichever name the parameter holds. Sixty
three environment reads across the corpus were of that shape, and every one of them was a name invented by
the reader and reported as a fact about the program.

A literal key is unchanged and stays a path, because `x['k']` selects the entry named `k` by the language
definition and leaves nothing open. The `ComputedMemberExpression` branch written to handle that case is
removed: `parseSync` returns an ESTree shaped tree, and that node type occurs 0 times in 5,253 corpus files.

### A framework gap naming a distribution the repository does not have

`crewai-examples` reported `agents is imported here and its adapter found nothing`, and there is no such
gap. Three `main.py` files write `from agents import ...` and each keeps an `agents.py` beside it; no
checkout of that repository declares a distribution called `agents`. `adapter:openai-agents` was recorded
`completed` over three files of a repository that uses none of it, which is the coverage report naming this
build's own ceiling in a place where the ceiling is somewhere else entirely.

**The cause is three layers deep and the two obvious ones are not the load bearing one.**
`adaptersThatFoundNothing` builds its import set with no locality filter at all, where `projectUses` applies
one. The filter it would have applied is `localPythonRoots`, which collects a package at the repository root
or under `src/` and therefore collects **nothing at all** on a repository of per directory applications: the
measured set for `crewai-examples` is empty. And repairing both of those would still not have moved this
entry, because `moduleMatches` consulted its local roots only for a dotted specifier, so the bare `agents`
matched the distribution by exact equality before locality was ever consulted.

**What replaces it is the interpreter's own rule, and it is filesystem exact.** A script runs with its own
directory first on the module path, so a module beside it shadows any distribution of that name. A file
inside a package does not: its directory is reached through the package and never sits on the path, which
makes `__init__.py` the discriminator rather than the depth of the path. `crews/instagram_post/` holds no
`__init__.py`, so its `agents.py` wins. `openai-cs-agents-demo` is the entry that makes the distinction load
bearing rather than decorative: it also keeps an `agents.py` beside a file importing `agents`, that file is a
package member, and its import really is the SDK.

**A root is deliberately left ambiguous, and one corpus entry is the reason.** Locality by root still answers
only for a submodule reference such as `agents.agent`. `openai-agents-python` defines `src/agents/` and its
own files import `from agents import ...`, where the name is at once this repository's package and the
framework whose declarations the adapter exists to read. The syntax does not say which, so nothing is
suppressed there and the framework stays readable. Widening that would have cost the entry every component it
has.

Measured across all twenty seven pinned repositories: one entry pair moves and twenty four are byte identical.
`crewai-examples` and `crewai-examples-exercised` record `adapter:openai-agents` as `not_applicable` over zero
files and an empty `foundNothing`. `crewai` still reports `mcp`, which is a correct refusal. Component and
relation counts do not move on any entry, and `crewai-examples-exercised` still records zero exercised
components against three ambiguous names. `orchescope-discovery` counts one file more, because the locality
rule is a file of its own and that entry is this repository's own `packages/discovery` copied from the index;
its ceiling of zero components is unmoved, which is the number that entry is pinned to hold.

`docs/architecture/mapping-architecture.md` proposed this as two defects and it is three. The document now
says so, and says which one was load bearing, because the two it named could both have been repaired without
moving the entry.

### One model call, two producers, and the first corpus entry that can see it

0.8.0 taught the reader to keep the better placed of two spans watching one model call, and to stop naming a
model call after the host that served it. It also said plainly that **no corpus entry witnessed either
change**, and named the reason: every entry carrying a run drove an offline model, or ran Python where the
`fetch` shim does not apply, or reached a provider through `openai@4`, which bundles `node-fetch` and is
invisible to a patch on `globalThis.fetch`. What held both fixes instead was one stored run in
`packages/traces/test`.

`openai-agents-js-provider-exercised` is the entry that can hold them. It is the same commit as the two
`openai-agents-js` entries, and it runs the repository's own `examples/basic/hello-world.ts`: one agent
holding no tool and no handoff, answering one turn. `@openai/agents` resolves `openai@6`, which has no
dependencies and makes its requests with `globalThis.fetch`, so four spans arrive from two producers, three
from `@arizeai/openinference-instrumentation-openai-agents` and one from this build.

**The witness is a component count.** The graph without a run holds 9 models. This entry records 10. A run
read as two calls would record 11, because the two producers name a model differently and both names are
real: `gen_ai.request.model` is `gpt-5.4-mini`, what was sent, and `llm.model_name` is
`gpt-5.4-mini-2026-03-17`, what came back. The one kept is the response's, which is the second fix as well:
were `orchescope.component` still set on a model call, every model this run reached would arrive as one
component named `api.openai.com`.

**The shape is what makes a provider run pinnable at all, and the hermetic sibling is why that had to be
solved.** That entry drives the customer service example, and its own prose records why it drives an offline
model: against a real `gpt-4o-mini` the same conversation produced eight spans, then eleven, then eight,
because whether the seat agent asks for a confirmation number again is the model's decision. An agent with
nothing to call has no decision to make. One turn is one model call whatever the answer says, so the driver
registers the instrumentation and supplies nothing else.

Three entries now sit on that commit and the arithmetic between them is the check: 668 components with no
run, 669 with the hermetic one, which adds an agent nothing declared, and 670 here, which adds that agent and
the model. Neither the agent nor the model joins, and both reasons are already on the record: this checkout
declares 292 agents across its examples and four of them are named `Assistant`, so the reconciler refuses the
name the way it refuses `Triage Agent` on the sibling, and no model has ever joined a declaration anywhere in
this corpus because a model is chosen where a run is configured rather than where an agent is written.

**The dated model is the provider's and not the repository's.** `hello-world.ts` names no model, so the alias
comes from the pinned SDK and the snapshot behind it comes from OpenAI. When they move it this entry differs
on one identifier, which is a true report that the provider changed. `open-deep-research-exercised` has
carried a dated snapshot the same way since it was pinned.

### A corpus metric that reported its own ceiling

`componentsByRule` exists because `byRule` cannot see a grouped rule move: one finding is reported whatever
it found, so the count holds at one while the subject swings. It was summed from the components each finding
lists, and grouping lists at most twenty five of them.

So the metric was the cap. `declared-not-exercised` on the CrewAI run names a hundred and thirty components
and this file recorded twenty five, and would have gone on recording twenty five whatever that rule did next,
which is the silence the metric was added to break. The finding says both numbers already: grouping records
what it withheld as a metric whose `value` is the number withheld and whose `sampleSize` is the whole
affected population.

Seven entries move and every move is the same move. `openai-agents-js-exercised` reads 417 declared and never
exercised components where it read 50, `crewai-examples-exercised` 130 where it read 25, `topology-shape` 53
where it read 28, and `model-call-without-timeout` 50 where it read 25 on the same entry. Nothing about any
of those repositories changed.

A rule that cites a sample rather than enumerating a population carries no such metric, and for those the
list is still the whole answer: `observability-coverage` names ten unexercised components to support a rate
whose own sample size is the declared population, and ten is what it means.

### A configuration path opened on every scan and read by nobody

`config/tasks.yaml` was in the list of paths every scan opens, and the string appeared exactly once in this
repository: in that list. No adapter read it, so every scan of every repository paid a file open for a
document that was parsed and dropped.

Reading it is not the cheap half it looks like. A CrewAI task is a unit of work with a description, an
expected output and the agent it is assigned to, and `COMPONENT_KINDS` has no kind for one. Giving it a kind
is a schema decision, and calling its description a prompt instead is a judgement about the vocabulary rather
than a parser to write. Either is worth doing on its own evidence; neither is worth carrying an open file for
in the meantime.

Nothing in this corpus loses anything: the twenty `tasks.yaml` in the pinned CrewAI examples repository all
sit beside their `agents.yaml` inside a package, none at the root, so the fixed path never reached one of
them, and no corpus number moves.

### The relation a CrewAI run looks like it reports and does not

`graph.node.parent_id` was in the trace attribute vocabulary and read nowhere, and a CrewAI run reports zero
relations against sixteen declared, so it read as the obvious thing to wire up. Every agent span after the
first carries it, and on the pinned marketing crew the values draw exactly the sequence the crew runs in.

**They are not a sequence anything ran in.** `_find_parent_agent` in
`openinference-instrumentation-crewai` walks `crew.agents`, finds the index of the agent whose task is
executing, and returns the role of the entry before it. It is a position in a declared list, evaluated at
span time. The measured tell is in the run already stored: the marketing strategist ran two tasks, the second
of them straight after its own first, and both spans name the market analyst as their parent, because the
analyst is the entry before the strategist in `agents=[...]`.

Reading it would take a declaration this build already reads out of the source, send it through the process
under audit, and report it back as a relation a run exercised. That makes the two halves of the join agree by
construction, which is the one thing this join must never do. So the attribute is out of the vocabulary and
the measurement is written where it was, for the next reader who notices the same gap.

A CrewAI run still reports no relation, and the reason is unchanged and elsewhere: the crew span is a `CHAIN`
carrying no name, so it is declined and nothing nests inside a declined span.

### The agents document CrewAI writes inside the package

`crewai create crew` writes every agent's role into `src/<package>/config/agents.yaml`, and CrewAI reports an
agent by its role at run time. The config reader opened `agents.yaml` at the repository root and at
`config/agents.yaml` only, so on a real CrewAI application **no component in the graph carried the name its
own run reports**. Twenty such documents in the pinned examples repository went unopened, every one of them
at a path ending `config/agents.yaml` and none at the root.

That was not a missing answer, it was a wrong one. The marketing crew ran, reported its three agents by role,
and the only declaration of those three names anywhere in the repository belonged to `crews/instagram_post`,
which writes the same three roles as literals and which the run never entered. The join was made by
`runtime_name`, the strongest rule reconciliation has short of a code location, on a declaration that was
perfectly true. **`crewai-examples-exercised` recorded three exercised components and all three were the
wrong file.**

**Reading the file was the least of what had to change.**

**Where a document found by name is allowed to live.** `platformConfigPaths` filtered the bounded traversal
by basename against three `wrangler.*` names, sorted, and cut at 32. Adding `agents.yaml` and `tasks.yaml` to
that set puts 40 candidates under one cap of 32 on the examples repository and drops eight; adding a root
`wrangler.toml` and a `packages/worker/wrangler.toml` to the same repository drops **both of those too**,
because the list sorts by path and `c`, `f` and `i` sort before `w`. That is the 0.6.0 fix undone by a name
put in the wrong set, and no test and no corpus entry would have caught it: no test anywhere referenced
`platformConfigPaths`, and all 26 expectations record `adapter:workers-bindings` finding nothing. So the
mechanism is now a table of named kinds with a cap each, `namedConfigPaths`, and a fixture with forty agents
documents and one `wrangler.toml` in it asserts the manifest still comes back. The agent declaration cap is
64 against the 20 that repository declares.

**What names a configured agent.** The document holds two names for one agent, the key it is filed under and
the role beside it, and only the second is what a run says. Naming by the key is what made the wrong join
survive: measured against the real reconciler, reading all twenty documents while still naming by the key
leaves the same three wrong matches in place and only downgrades the rule that made them from `runtime_name`
to `kind_and_name`. Naming by the role gives each of the three names three declarations, `uniqueCandidate`
returns nothing, and the reconciler records an ambiguity. The key stays as the pointer the evidence carries
and as the name the document binds the component under, which is what a caller writes to select an entry.

**A role with a placeholder in it.** CrewAI interpolates a role before it uses it, and four of the seven
agents in the framework repository's own three documents declare one of the form `{topic} Senior Data
Researcher`. That string is a name no run will ever report, so those are named by their key and declare no
runtime name. A call site is treated differently and keeps naming itself by whatever literal it carries: it
has no second name to fall back to, and declining the literal sent fourteen calls in one test file to the
variable `agent` they share, which is the collapse 0.8.0 fixed. Both sides decline the promise, and the
adapter run now carries a detail counting every decline in the repository: on the pinned framework it reads
24, four in documents and twenty at call sites. A decline nobody states reads as an absence. That detail
arrives on `--json` and over MCP: the terminal renders an adapter's detail only when the adapter failed, and
this one completed.

**`agents.yaml` is a file name and not a framework.** The adapter applied whenever any config document path
ended in `agents.yaml`, with no check that the document looked like a crew. Once the name is found wherever
the traversal walked, that makes any repository holding a file of that name a candidate agent system: two
constructed repositories depending on express and on axios, with a root `agents.yaml` holding hosts and
ports, were both reported as detected agent systems whose agents were the entries of that file. This is the
failure already recorded for `.mcp.json`. A document now has to declare at least one entry carrying a
non-empty string `role` and `goal`, which admits all 55 real agent entries in the two pinned checkouts, 48
across the examples repository and 7 across the framework's templates and tests, and admits this
repository's own two entry fixture, whose entries carry no backstory.

**A shape is not a framework.** A roster whose entries carry a role and a goal passes that test, and a
repository depending on express and holding a `deploy/agents.yaml` of account executives was reported as a
detected agent system with two CrewAI agents in it. So a document found by file name is read only where the
repository declares CrewAI. The layout this whole reading exists for cannot occur without the dependency,
because the call that selects an entry imports the framework to run at all, and the two fixed root paths are
left as they were: they were read before the traversal found any of these, and gating them would be a second
change wearing this one's clothes.

**Two components for one agent, on purpose.** This adapter's own comment claimed that "configuration wins
when both are present and the source pass fills in what configuration does not declare", and neither half was
implemented: both passes run unconditionally and their components cannot merge, because a config namespace is
a file path and a module namespace is that path with the extension removed. The comment is now corrected
rather than implemented. `Agent(config=self.agents_config['lead_market_analyst'])` is the whole of the link
between the two, the fact model records that argument as an unknown subscript with no key in it, and the
obvious substitute is measurably unsafe: the enclosing method name is a key in the neighbouring document for
31 of the 50 `Agent` calls that sit beside one, and the other 19 would attach a call to the wrong declared
agent. So three of the four agents of one pinned crew are two components each. That doubling is the price of
not guessing, it is stated in the corpus entry, and closing it means teaching a parser to carry a subscript
key first.

**What moved.** `crewai-examples` goes from 144 components to 192: 48 agent keys across 20 documents, all 48
declaring a role and **none declaring an `llm`**, so no model and no relation follows. `crewai` goes from 847
to 854, which is the seven keys of its three documents; `declaredInTest` does not move, because a component
read out of a document has no source location and that flag is derived from source locations alone.
`crewai-examples-exercised` goes from three exercised components to **zero**, gains the three names under
`joins.ambiguous` and three runtime only components, and raises a fourth finding. **Zero is the fix.** It is
the same shape of refusal `open-deep-research-exercised` already records for `supervisor`, and a refusal that
names what it refused is worth more than a confident join to a file the run never opened.

**And the rule that reads the refused names called them undeclared.** `exercised-not-declared` printed
"static discovery found no matching declaration" over three names the repository declares three times each.
That rule already had a branch for an observation whose name cannot identify anything and none for one whose
name identifies too much, and the sentence had shipped for `supervisor` on the pinned deep research run since
that entry was pinned, so this change made a false sentence visible on a second entry rather than inventing
it. `observed-name-matches-many-declarations` now reports them, `exercised-not-declared` diverts them and
names the count it handed over, and a run whose every observation was refused no longer reads as a run that
joined perfectly, which is what a filter alone would have produced: `fired` with nothing left becomes
`clear`, and `clear` there claims every observed component matched a declaration.

No goal is cut from the new rule. Clearing it means one of the declarations giving up a name, and which one
is a decision about the repository: on the pinned examples two of the three are a crew and a copy of that
crew, so renaming either is wrong, and a CrewAI role is part of an agent's prompt rather than a label. A code
location on the span settles it without touching any of them, which is a change to the instrumentation. The
finding says both, and says which declarations share the name.

**Three of the four entries that carry an ambiguous name were printing that sentence, and two of them are
nothing to do with CrewAI.** `openai-agents-js-exercised` reported `Triage Agent` as a component nobody had
declared; the SDK's own examples declare it **seven times**, and the run exercised one of them. That entry
and `crewai-examples-exercised` both move as recorded: `exercised-not-declared` leaves their `byRule` and
`observed-name-matches-many-declarations` takes its place, over the same components.

`pydantic-ai-exercised` does not move, and the reason is the precedence between the two rules. Its observed
name is `agent`, which is ambiguous because a name that is only the word for a kind matches every declaration
of that kind. `observed-name-carries-no-identity` keeps it, because that rule owns the half a reader can act
on: naming the agent at its definition is one bounded edit and it settles the ambiguity as a side effect.
One observation gets one finding.
`open-deep-research-exercised` reaches a provider, and it was re-recorded against a live run of it. It moves
by four keys and no more: `componentsByRule.exercised-not-declared` from 4 to 2,
`observed-name-matches-many-declarations` arriving at 1 finding over 2 components, and `findings.total` from
8 to 9. `byRule.exercised-not-declared` stays at 2, because the model and the tool it still names differ in
severity and group separately. Nothing outside the findings block moves: the delta is untouched and only the
rules that read it changed, and the run reproduced its 31 spans and its whole runtime block unchanged, which
is the part of that entry a provider was least likely to hold still.

**A role is not unique inside a document and a key is.** Naming by the role alone let two entries of one
document collapse: the builder merges on identity, and the survivor of two agents declaring `Market Analyst`
carried the first one's goal beside the second one's runtime name and the second one's model, with nothing in
the output saying two declarations had become one. And the merged component was then *unique*, because
`uniqueCandidate` dedupes by component id, so a run reporting that role joined it by `runtime_name`, which is
the wrong answer this whole change is about, reappearing one level down.

A role that names two entries of one document is not a name for either, so both take their key. Each still
declares the role, so a run reporting it matches two components and is joined to neither. Measured on that
repository: no match, one runtime only component, and `joins.ambiguous` does not name it either, because the
reconciler records an ambiguity only where kind and name found more than one and a tie in the runtime name
lookup alone falls through to unmatched. That is a second place where a refusal is made and not stated, and
it is the reconciler's to fix rather than this adapter's.

**A document opened for one kind is not another kind's to interpret.** `mcpServers` is a key nothing else
writes; `servers` is a word anything may use. Once `agents.yaml` is found wherever the traversal walked, a
`servers` inventory of hosts and ports under `deploy/agents.yaml` was read as two MCP servers, one of them
declaring permission to execute `/usr/sbin/nginx`, and a repository depending on express and nothing else was
reported as a detected agent system. That is the `.mcp.json` failure arriving through a different door, in an
adapter that had no shape gate of its own. A document now records why it was opened, and a reader of one kind
declines a document opened for another. The MCP adapter also counted a document with an empty server map as
one it had inspected, which is now counted where a server is actually read.

**Two silences the widening made worse, both now audible.** `readConfigDocuments` recorded every read and
parse failure and had no consumer: `discover` took its documents and left its problems, so a crew whose only
agents document has a syntax error reported no agent and no reason, which reads exactly like a repository
that declares none. The population that can hit it was at most forty three paths before this change, eleven
fixed plus a cap of thirty two deployment manifests, and is at most a hundred and six after, ten fixed plus
caps of thirty two and sixty four. So the failure now goes in `coverage.skipped` under `parse_error` or
`unreadable`, and in the count beside it. Both names were already in the vocabulary; neither had ever been
written by a configuration document.

And a cap that truncates and says nothing reports its own ceiling as though it were the answer: seventy
agents documents under a cap of sixty four produced sixty four agents, `truncated: false`, an empty skip list
and nothing anywhere to separate it from a repository that declares sixty four. `coverage.truncated` is
documented as true when analysis was cut short by a deadline or a resource limit, a cap is a resource limit,
and that flag is now set when one truncates. **What the reader is not told is which ceiling was reached**,
because there is one flag and naming the ceiling means a fifth `UnsupportedAreaKind` or an eighth
`SkippedFile.reason`, both closed sets and both the maintainer's decision. Neither cap is reached by anything
in this corpus, so both of these are held by tests and by nothing else.

**Left alone and worth naming.** A component read out of a document carries no source location, and
`declaredInTest` is derived from source locations, so the two agents in the framework repository's
`lib/crewai/tests/config/agents.yaml` count as part of the system under audit rather than as something only
a test declares. Deriving that flag from configuration locations as well would change it for every adapter
that reads a document, which is its own change with its own evidence.

`adapter:mcp` reported every configuration document the scan parsed as a file it had inspected, which cost
nothing until `agents.yaml` became a name found in the traversal and it began claiming three documents on the
CrewAI framework repository that it read no server from. It now reports the documents that declare one, the
same way the CrewAI adapter now reports only the documents it read. Four expectations move by one each:
`openai-agents-js` was counting `integration-tests/cloudflare-workers/worker/wrangler.jsonc`, and
`pydantic-ai` was counting `.claude/settings.json`. Neither claim was pinned by a test, which is why the
CrewAI fixture now carries a `.mcp.json` neither adapter reads a word of and asserts what each one counts.

### A runtime name declared for an agent no run will call that

`runtimeName` is a declaration that a running system will report a component under this name, and
reconciliation trusts it above everything except a code location. A value that is not a name any run can
report therefore does not merely fail to match. It sits in the strongest lookup in the reconciler waiting to
match something else.

The CrewAI adapter declared one for every agent it found, set to whatever name it had chosen: the role where
one is a literal, and otherwise the variable, the method, or the constant `agent`. So the three agents of the
pinned marketing crew declared that a run would call them `lead_market_analyst`, `chief_marketing_strategist`
and `creative_content_creator`, which are the methods that build them and are names CrewAI never emits. The
same held on the two declarative paths: an `agents.yaml` agent declared the key the document files it under
rather than the `role` beside it, and a crew document declared the file name each member is declared in.

A role is now the only thing that produces one, on both paths, trimmed of the newline that ends a folded
`role: >` block. Where no role was read there is no runtime name, which is the true statement: this build
does not know what the run will call that component, and the join is left to the rules that match on what
was actually read.

**No number in the corpus moves, and that is worth saying rather than leaving as a silence.** The three
joins `crewai-examples-exercised` records are made against `crews/instagram_post`, whose roles are literals,
so its declarations are unchanged and it still matches. What changed is that three false declarations left
the strongest lookup. The witnesses are fixtures: a configured agent whose folded role differs from its key,
a source agent built inside a decorated method, and a crew document, which had no fixture at all until now
and so no statement of what it promises.

**This does not fix the wrong answer, and the entry still records it.** The run's own roles are in an
`agents.yaml` under `src/<package>/config/`, and the config reader opens that name only at the repository
root. Reading it where it lives is a larger change than it looks: measured on the pinned examples repository
it would add 48 agent components across 20 files, and adding the name to the set that already finds
`wrangler.toml` by name would put 40 candidates under one cap of 32 and silently drop both Cloudflare
manifests, which is the fix 0.6.0 made. It needs its own measurement.

### The other half of that placeholder, which the repository already wrote down

The scenario template gave a caller somewhere to declare the command that starts their system and still
handed them `['node', 'src/main.js']` to replace. Most repositories have already written the answer down:
`scripts.start` and `scripts.dev` in `package.json`, a console entry point under `[project.scripts]` in
`pyproject.toml`, a line of a `Procfile`.

Those are now read and offered as comments above the placeholder, each with the file and the line it came
from, so a reader checks a candidate against their own repository rather than trusting one this build picked:

```
target:
  # The command that starts your system. Orchescope never guesses this.
  # Declared in this repository, read and not run. Pick one, or write your own:
  #   npm run start    (package.json:6)
  #   node src/main.js    (Procfile:1)
  command: ['node', 'src/main.js']
```

**None of them is ever run and none of them becomes the value the parser reads.** A `start` script is often
a server that never exits, which is why the field they sit above carries a timeout and a stop signal at all,
and a test asserts that the placeholder is still what the runner would execute. A candidate whose declaring
line cannot be located is left out rather than cited at a guessed line, and the command is redacted before it
is written back, because a declared command is repository text and may carry a credential inline. Redaction
is not a guarantee, which is one more reason these arrive as comments a person reads.

The refusal is unchanged: `orchescope trace` still carries a placeholder, because a candidate is a thing the
repository declares and not a statement that running it produces the run you want.

### The one command in the loop with a placeholder in it

`orchescope trace -- '<the command that starts your system>'` is what step one offers a repository nobody has
run, and it is the only argv in the loop a caller cannot execute. That is deliberate: the command that starts
somebody else's system is not a fact any adapter reads, and inventing one would mean running a guess. What it
costs is that an agent stalls there on every untraced repository, and a person retypes the command on every
run.

A scenario is where that command is already declared: an argv executed without a shell, with the directory,
the environment, the ceiling that stops it and how the target reports its own outcome. `orchescope init
--scenario` writes the template to declare it in, the same way `--manifest` writes one for components no
adapter can read. Nothing about the refusal changes; what changes is that the question is answered once
rather than every time.

**It is written under `.orchescope` and scenarios are read from `scenarios/`.** Everything Orchescope writes
goes under one directory so that removing it is the whole cleanup, and a template written where scenarios
load would report a scenario nobody wrote. Landing outside that directory is what lets the template be a
complete scenario the parser accepts rather than a commented sketch, and `tests/e2e/scenario-template.test.ts`
walks the whole path: write it, check the audit still counts zero scenarios, move it, run it, and assert it
passes its own evaluator over the three repetitions it declares.

The measure step now names the flag in its detail when a repository has no scenario at all, and stops naming
it once one exists. The command it carries is unchanged, because a reader who knows how their system starts is
one `trace` away and should not be sent to write a file first. The terminal renders at most one detail row per
step and this is the second, so it arrives on `--json` and over MCP rather than in the human document, which
is where the caller that could not fill in the placeholder was.

`RESULT_SOURCES` and `SCENARIO_PERMISSIONS` are exported from `packages/schema` so the template lists the
vocabulary the validator accepts rather than a copy of it. The emitted documents under `schemas/` are byte
identical, so this is not a schema change.

### An agent connecting over MCP was told nothing before it had to choose

The protocol carries one string a server can send at the handshake, and this one sent none. So a coding
agent arriving here saw seventeen tool names and no statement of where to begin, and the honest first move
was a guess between `scan_agent_system`, `get_system_map` and `get_findings`. None of the three is wrong and
none of them is the beginning.

The loop was already in the payload and had been since it was written. `audit_agent_system` returns which of
the five steps a repository is standing at and the one next action, with `loop.next.tool` naming the tool and
the arguments where a tool exists. **What was missing was the sentence that says to start there.** The server
now sends it: what Orchescope is, call `audit_agent_system` first, then follow `loop.next.tool`.

It stays four short paragraphs and a test holds it there, because this text is prepended to a context window
on every session and a front door that has to be read is not a front door. A second test fails if it ever
spells a tool name that does not exist, which is the drift nothing else here would catch: renaming a tool
would leave the entry point pointing at nothing.

No behaviour changes and no schema changes. What moves is what an agent knows before its first call.

### The README leads with the loop rather than with the capability list

A reader met seven bullets about what Orchescope does, five about what it does not, and a section on
verifying a tarball, and reached the loop sixty lines in. The loop is the whole interface: install, run one
command, get told the single next thing, and find out whether it helped. It is now the second section, as
five named steps with the command that runs each one, and it says plainly that a coding agent runs the same
loop with no person in it.

The five steps in that table are the five an audit prints, and `tests/e2e/documented-loop.test.ts` compares
them against a real audit rather than against the constants, because the constants are the half a reader
never sees. Renaming a step in one place and not the other used to move nothing a gate would notice.

### CrewAI at run time, which nothing anywhere had measured

CrewAI is measured at run time for the first time. It was the one framework in the README's support table
whose "Joined on a run" column read `not yet`, it had never produced a span in any corpus entry, and
everything this build claimed about the dialect had been argued from the adapter alone.

The corpus now pins `crewAIInc/crewAI-examples`, which is sixteen crews and seven flows written the two
ways the framework's own documentation writes one, and a second entry drives the marketing crew inside it
through `openinference-instrumentation-crewai` against a model that answers from the driver's own process.
Neither entry replaces `crewai`: that one is the framework, 302 of its 843 components are declared in its
own tests, and what it holds is the parse rate.

### Every agent in a file was one component, named after the call

`crewai create crew` generates a `@CrewBase` class whose agents are returned from decorated methods, and it
writes each agent's role into a document rather than into the call:

```python
@agent
def lead_market_analyst(self) -> Agent:
    return Agent(config=self.agents_config['lead_market_analyst'], verbose=True)
```

The adapter names an agent by the role it declares, then by the definition the call sits in, then by the
constant `agent`. `definitionForCall` looks for a variable or a function, and a method is neither, so every
agent written this way took the constant. **On the pinned examples repository that made forty four `Agent`
calls into nineteen components, one per file, each named `agent` and carrying every call site in it.** A
crew of three agents was one component, and the two a reader could not see were not reported as unread
either: nothing said a name had been declined.

`enclosing` is the nearest named function, class or method a call sits inside, and the fact model already
carried it, so the method that returns the agent names it without a parser learning anything new. The
nineteen become forty three, and the one pair that still shares a component shares a method name across two
classes in one file, which is a repository writing the same name twice.

`crewai-examples` goes from 49 agents to 73. `crewai` goes from 843 components to 847: three collapsed
components become seven, three of them in its own test suite and four in the project templates its CLI
writes, and nothing else in that repository moves. That is the difference between a framework and a use of
one.

### What a CrewAI run says, and what it matches

Six spans: one for the crew and one per task, each task's span carrying the agent's role under
`graph.node.id` and the OpenInference `AGENT` kind. This build reads all five agent spans and three
components come out of them, two agents having run twice.

**All three of those components are the wrong ones, and the entry records them rather than hiding it.** The
run was of `crews/marketing_strategy`, whose three agents are declared by the methods that return them. Its
roles live in an `agents.yaml` this build does not open, because the config reader looks at the repository
root and `crewai create crew` writes the file into the package. So no component in the graph carries the
name the run reports for its own agents, and the join goes looking. `crews/instagram_post` declares three
agents with a literal role, and its three roles are the same three words. The adapter declares a role as the
name a run will report, so the match is made by `runtime_name`, which is the strongest rule reconciliation
has short of a code location: the entry records `byRuntimeName: 3` and `byKindAndName: 0`. The rule is
working on a true declaration, and the report still names a file the run never entered.

On a repository holding one application it would have matched nothing at all, which is the ordinary case
and is a truer answer. Opening the packaged `agents.yaml` is the change that closes it, and it would make
these three names ambiguous rather than unique, so what a reader would then get is a refusal.

**The crew joins nothing for an unrelated reason.** Its span carries the `CHAIN` kind and no
`gen_ai.workflow.name`, which is a span saying that something is nested here and nothing about what, so it
is declined and counted as `no_name`. Nothing nests inside a declined span, so a run that walked three
agents under one crew reported no relation at all: `exercisedEdges` is zero against sixteen declared.

**No model span is produced and no tool span.** The instrumentor opens spans for `Task._execute_core`,
`Crew.kickoff` and `BaseTool.run`, and writes no model span unless it is started with an event listener, so
a CrewAI application pairs it with an instrumentor for whichever client it calls. The tool half is a limit
of the run rather than of the build: both tools that crew declares search the internet, so the scripted
model asks for neither, and this entry therefore says nothing about what a CrewAI tool span looks like.

### An entry can name the interpreter its framework installs under

CrewAI and its instrumentor both declare `requires-python <3.14`. On a machine whose `python3` is newer,
pip resolves `crewai` down to 0.11.2 and then fails building a `tiktoken` with no wheel for it, so an
environment built from the wrong interpreter measures a release from before any of this existed rather than
failing. An exercise may now declare `pythonInterpreter`, a machine without that interpreter skips the
entry with the reason printed the way a missing credential does, and the environment marker records the
interpreter alongside the package list so that changing it rebuilds rather than reuses.

## 0.8.0

Released 2026-08-20 from npm as `orchescope@0.8.0`, published locally with `npm publish --no-provenance`,
so this release carries no registry attestation. `pnpm package` builds from this tag a tarball byte
identical to the one on the registry, which was checked by downloading the published one and comparing:

```
sha256  697b83cc55e54806f889b2e4f009dd07ad611c51ee12b02a1dfee64bf603d60c
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes
match this source; it does not say who published them. The registry's own signature is on the version and
is a different thing: it says npm served what npm stored. Installed from the registry the binary reports
`0.8.0` and `orchescope doctor` passes every required check, which is the one that matters, because the
parsers resolve a native binding and a WebAssembly grammar relative to their own package directories and
only a real audit from an installed tree proves those resolve.

**No published document changes.** `packages/schema` and `schemas/` are untouched, so a consumer reading
0.7.0's shape reads this one.

The changes below came out of LangGraph and OpenAI Agents applications, one read and three traced, and
every one of them says the same thing: a fact read in one ecosystem is not read in the other. Three of the
four readings this build has of these two dialects were argued from Python spans alone, and each of the
JavaScript instrumentors writes at least one of them differently.

**A reader with a LangGraph application sees their declared graph grow whether or not they have ever traced
it**, because the routes a node declares by returning a `Command` were invisible and are now relations. That
moves reachability, cycles, entry points and the coordination fan out, and on the pinned application it
turns a strength into four cycles. A reader with a stored run sees their component counts and their join
move as well, without retracing, because every reading here is derived when a report is built rather than
when a span is stored.

### One model call, counted twice

`orchescope trace` patches `fetch` in the target so that a run of a system with no instrumentation of its
own still says something. A system worth auditing usually has its own, and then both watch the same
request: this build from outside, the target's instrumentation from inside the SDK that made it. Two spans,
one call.

Read as two calls it doubled everything a reader counts. A run of the pinned OpenAI Agents example made two
model calls and reported four, and because the two producers name a model differently it reported two
models: `gen_ai.request.model` is what was sent, `gpt-5.4-mini`, and `llm.model_name` is what came back,
`gpt-5.4-mini-2026-03-17`. Neither number nor name was wrong on its own. Together they described a system
making twice as many calls to twice as many models as it did.

**The two producers are told apart by the scope that exported them**, so no guess is involved: this build's
spans carry `orchescope` and nothing else does. **What settles which to keep is that the request was in
flight for the whole of the other span.** An SDK's model call contains the HTTP request it makes, and the
two are not even in one trace, because an instrumentation that bridges its SDK's own events after the fact
opens no context a patched `fetch` runs inside. Time is what relates them. One to one matching is not
attempted: the question is only whether something better placed already reported this call.

A superseded span is not an unattributed one. `unattributed` records what this build could not read, and
everything a superseded span said is reported by a witness that said more, so there is no gap to state and
the count there does not move.

**`orchescope.component` is no longer set on a model call.** It overrides every other name the topology
reads, so set to the host it reported every model a run called as one component named `api.openai.com`,
which is a name no repository declares. The module setting it already said it belonged only on requests
whose component genuinely is the host they went to, and a model call is not one.

**No corpus entry witnesses either change, and that is worth saying rather than leaving as a silence.**
Every entry carrying a run either drives an offline model or runs Python, where this shim does not apply,
so all twenty four match unchanged. What the changes are measured against instead is a stored run of the
pinned OpenAI Agents example against a real provider, held span for span in `packages/traces/test`.

**Why no model has ever joined a declaration was measured rather than assumed, and it is not what it
looked like.** A model is chosen where a run is configured rather than where an agent is written: the
pinned deep research application names its models in `Field(default="openai:gpt-4.1")` on a configuration
class, the pinned customer service demonstration names none and takes the SDK's default, and the pinned
memory agent defaults to a literal inside the function that reads its configuration. No adapter reads a
model reference from any of those positions, so on all three the static side declares no model at all for
the run to match. The two entries that do declare models drive an offline one. A rule matching a declared
model against an observed model that differs only by the version a provider answered with would have fired
nowhere in this corpus, so none was written.

**What the shim sees is narrower than a Node run**, which the same measurement showed. It patches
`globalThis.fetch`, so a target whose HTTP goes through `node-fetch` is invisible to it: the pinned
LangGraph JavaScript run reaches a real provider twice through `openai@4`, which bundles `node-fetch`, and
this build's shim produced no span for either call. That bounds both the double count and the fallback the
shim exists to be, and it is unfixed.

### The same handoff, written two ways

The OpenAI Agents SDK performs a handoff by calling a tool, and 0.7.0 taught this build to read that: a
tool span naming no tool, whose input and output are both names the same run reported as agents, is a
transfer of control between them. That was argued from one instrumentor's spans, the Python one, and the
SDK has two.

The JavaScript instrumentor writes the same handoff differently in both halves the reading depends on. It
names the span's tool `handoff_to_Seat Booking Agent`, where the Python one names no tool at all. And it
writes each agent inside a JSON document, `{"from_agent": "Triage Agent"}` and `{"to_agent": "Seat Booking
Agent"}`, where the Python one writes the two names bare. So the span was declined twice over, and a
transfer of control was reported as a call to a tool nothing declared: the same defect 0.7.0 fixed,
untouched in the other ecosystem.

**The documented form is read even where the span names a tool, and the bare form still is not.** That
asymmetry is the argument rather than an exception to it. A tool name is a repository's to choose, so once
a span has said which tool it called, two bare strings that happen to match agent names say nothing more.
A document whose two keys are `from_agent` and `to_agent`, whose values are both agents the same run
reported, has said what it is. Both ends still have to be agents the run itself reported, which is the
check neither form skips.

`openai-agents-js-exercised` moves `hands_off_to` from twenty eight relations to twenty nine, `calls_tool`
from eighty to seventy nine, and drops the tool component from the graph, so `exercised-not-declared` names
one component where it named two. `openai-cs-agents-demo-exercised` does not move, and it is the control.

### A graph declared from inside its own nodes

The LangGraph adapter read `add_edge` and `add_conditional_edges`, which is how the library's first
documentation wires a graph and is neither of the ways the pinned `open_deep_research` application does it.
A node there returns `Command(goto="write_research_brief")`, and seven of the eight relations that file
declares between its own nodes are written that way. Nine nodes with exactly one relation between two of
them was the whole declared graph, which is the single `add_edge` its file contains.

**What that produced was not a missing finding but a wrong one, reported as a strength.** `topology-shape`
read a graph with almost nothing in it and said the declared topology is reachable, acyclic and narrow. The
application is a supervisor loop: `supervisor` commands `supervisor_tools`, which commands `supervisor`
back, and `researcher` and `researcher_tools` do the same one level down. Telling a reader their agent
topology is acyclic because the edges could not be seen is worse than saying nothing.

A `Command` whose `goto` is a string literal naming a node the same module declared is now read as a
handoff from the node the call sits inside. Which function implements which node is what `add_node` already
states, so both ends are named by the same authority the rest of this adapter reads.

The route is taken from the call rather than from the `-> Command[Literal["a", "b"]]` return annotation
that usually sits above it. The annotation is the fuller statement and it is the one the fact model does
not carry: a return type is not a call, an argument or a definition, so reading it means teaching two
language parsers a new fact first. Where the two disagree, the call is the one a reader can check by
running it.

Nothing is read from `goto=END`, from a `Send` fan out, or from a name computed at run time. The sentinel
needs no special case: `__end__` is never a declared node, because `add_node` rejects the name.

On `open-deep-research`, `hands_off_to` goes from eight relations to eighteen, and every one of the ten is
a line in that repository a reader can open. `topology-shape` stops reporting a strength and reports four
cycles across eight components. `open-deep-research-exercised` moves by the same amount and still agrees
with it, which is the invariant that pair exists to hold, and its `declaredEdges` goes from sixteen to
twenty six while `exercisedEdges` stays at zero. **The delta gets worse and that is the point:** LangGraph
opens each node's span under the compiled graph rather than under whichever node routed to it, so the run
shows containment where the source declares routing, and none of the ten joins. Zero of twenty six is a
truer statement than zero of sixteen.

`langgraph` gains sixteen handoffs, all of them inside its own test files, so every component they touch is
marked as declared in a test and no rule fires on any of them. `langgraphjs` gains none, for two reasons
worth stating rather than leaving as a zero: it imports its own `Command` from a relative path rather than
from the package, and its graphs pass inline functions to `addNode`, which the fact model reduces to the
fact that they are functions. An application does neither. `gpt-researcher` gains none because it does not
use the idiom at all.

### The entry of a graph, read as a node of it

Everything this build reads out of the LangChain dialect was argued from one instrumentor's spans, the
Python one, and measured against nothing else. `openinference-instrumentation-langchain` exists twice, once
per ecosystem, and they are two programs. The corpus now pins a LangGraph application in JavaScript and
traces it, which is what says where they differ.

**They agree about the shape that carries the join**, which is the answer to the question the entry was
added to ask. The JavaScript instrumentor writes the same `metadata` document under the same attribute,
with `langgraph_node` in it, and names a node's span after the node, so both declared nodes of the pinned
application join and the reading crosses unchanged. Neither of the two relations that application declares
between its own nodes joins, and that is not a defect of either instrumentor: LangGraph runs a pregel step
by opening each node's span under the compiled graph rather than under whichever node routed to it, so the
run shows two siblings where the source declares a handoff.

**They disagree about `__start__`.** LangGraph keeps that name for the entry of a graph, `addNode` rejects
it in both ecosystems with the same message, and the adapter on the declared side has excluded it since it
was written. The JavaScript instrumentor opens a span for it anyway, named after itself and carrying itself
in `langgraph_node`, which is a node span's exact shape. The same two node graph written in both produces
three spans in Python and four in JavaScript.

So a run reported the library's own bookkeeping as an agent of the application, at medium severity, as a
part of the system that ran without being declared, with nothing in the repository a reader could declare
in answer. It is one per graph invocation, so a run through a subgraph reports it again.

Both reserved names are declined now, and the span falls to the rule that already declines a compiled
graph, which counts it as `no_name`. That is the accurate reason rather than a convenient one: the span
named the graph's own entry, and this build reads no name for a component out of it.

`memory-agent-js-exercised` goes from three agents to two and from seven components to six, and
`exercised-not-declared` goes from naming three components to two while still reporting two findings, which
is the pair `componentsByRule` was recorded in 0.7.0 for. `open-deep-research-exercised` does not move, and
it is the control: the Python instrumentor never opened that span.

**One thing the JavaScript instrumentor does not write is the provider, and that stays unwritten here.** It
writes neither `llm.provider` nor `llm.system`, so the model in that run is `model:gpt-4o-mini` where the
Python entry reads `model:openai/gpt-4.1-mini-2025-04-14`. Naming the provider from the model would be an
inference presented as an observation.

### Reachability answered by an unrelated HTTP route

`topology-shape` reports the components no declared entry point reaches. A component is an entry point when
nothing points at it, and a fully cyclic set of agents has no member with an inbound relation to spare, so
it yields no root at all. The answer to that was a fallback over the whole graph: with no root anywhere,
every candidate became one.

It fired on whether the repository had a root somewhere rather than on whether this part of it did. The
pinned customer service demonstration has six agents that hand off to one another and back, and three Flask
routes no adapter joins to the agent graph. The routes are roots, the fallback therefore never fired, and
the report said **seventeen of the twenty two components that participate in control flow cannot be
reached**, naming every agent in the application and every tool that is wired to one. Deleting the three
routes would have reported none of it. Reporting seventy seven percent of a system as unreachable is close
to reporting nothing, and an answer about one agent cannot turn on an unrelated HTTP handler.

A candidate no root reaches is now promoted to a root, one at a time and in candidate order, because
nothing reachable reaches it and that is what a way in is. Promoting the unreached set together would call
the far end of a chain an entry point while the near end hands off to it, so it is one per pass and the
traversal runs again.

**An agent is therefore never reported unreachable, and that is the honest reading rather than a
weakening.** An agent nothing points at was already a root. An agent inside a cycle nothing points into is
the only way into that cycle. What the unreachable half still reports is a component of a kind that cannot
be a root, which on that demonstration is the finding a person checked against the source: `baggage_tool` is
defined in its tools module and named in no agent's tool list.

`topology-shape` goes from naming twenty three components to naming seven, which are the six in the cycle
and `baggage_tool`. Both entries pinned at that commit move by the same amount and still agree with each
other, which is the invariant the pair exists to hold. No other entry moves, and `findings.byRule` does not
move on either of them: two findings before and two after. That number is the reason
`findings.componentsByRule` was recorded in 0.7.0.

### The provider a span names, where the span names it twice

OpenInference carries two attributes for it and this build read one. `llm.provider` names who hosts the
model; `llm.system` names the API it speaks. The OpenAI Agents instrumentor writes only the second, so the
two models the pinned customer service demo run reports were named `gpt-4.1-mini-2025-04-14` and
`gpt-5.2-2025-12-11` while every model declared beside them carries the provider serving it, and two models
of one name from two providers were one component.

Both are read now, host first. The LangChain instrumentor writes both, so
`open-deep-research-exercised` does not move, which is the control.

The three call sites that asked what a span names spelled it three ways, two of them with a string literal
rather than the vocabulary beside them, which is how one of them fell a convention behind. `providerNamed`
and `modelNamed` are the one spelling now.

### A relation counted as exercised that nothing declared

`coverage.exercisedEdges` counted every relation a run performed, including the ones reconciliation could
match against no declaration, while `coverage.declaredEdges` beside it counted declared relations only. A
fraction whose halves are drawn from different populations is not a fraction, and this one only ever
overstated: on the LangGraph application below, sixteen declared relations, sixteen of them reported as
never exercised, and an answer of eleven of sixteen.

Every entry in the corpus that carries a run had it. Reading each as `exercisedEdges` against the number
the same delta calls never exercised:

```
open-deep-research-exercised       11 of 16   where 16 of 16 were never exercised
openai-cs-agents-demo-exercised    11 of 42   where 37 of 42 were never exercised
pydantic-ai-exercised               2 of 597  where 597 of 597 were never exercised
vercel-ai-chatbot-exercised         2 of 31   where 31 of 31 were never exercised
```

The two halves add up now, which is the property that was missing and the one the tests assert. What each
entry actually joins is 0, 5, 0 and 0.

**This is the defect the component fraction beside it already had and had already fixed**, which is worth
saying plainly. The comment above the component pair records that counting an undeclared observation on
both sides made `15 of 22` on the demonstration system include a component nothing declared, and it ends
by noting that edges exclude a runtime only relation from their denominator. Nobody looked at the
numerator, and the corpus recorded neither number, so a fraction that could be off by sixty nine points
moved nothing anywhere. `runtime.declaredEdges` and `runtime.exercisedEdges` are recorded beside the
component pair now.

### What a LangGraph run says it ran, which one kind for everything hides

`isStructuralSpan` decides that an OpenInference span carrying a kind and no name is the instrumentation's
own structure rather than a component. That reading was argued from one instrumentor's spans and measured
against no other, and OpenInference has one kind, `CHAIN`, for everything LangChain composes: a compiled
graph, every node inside it, every subgraph, and every sequence, lambda and model wrapper a node happens to
build. None of them carries `gen_ai.workflow.name`.

So a run of a LangGraph application deleted the application. Thirty one spans walking all nine declared
nodes of the pinned `open-deep-research` graph left a model and a tool, no observed relation at all, and a
join reporting zero exercised components against twenty six declared. Twenty three spans were declined,
which the report did say, and there was nothing else to read it against.

**The spans do say what they ran.** LangGraph writes the node it is executing into LangChain's run
metadata, and the instrumentor emits that metadata verbatim under the OpenInference `metadata` attribute.
`langgraph_node` is the node's own name out of the application's graph, which is the same authority the
LangGraph adapter reads `add_node` from, so both ends of the join are named by the same thing. A chain span
that names a node is read as that node, and as an agent rather than as a workflow, because a node is what
the adapter on the other side of the join calls an agent.

**The node's own span is the one the graph named after it.** Every span inside a node carries the same
`langgraph_node`, because the attribute names the node the work happened in rather than the work. Reading
it off all of them reports one node as having run four times and counts its duration once per runnable
nested inside it, and an inflated sample size is worse than a missing component. Everything else inside a
node still names nothing, and a span that names nothing already attaches its work to the nearest enclosing
component, which is the node.

On `open-deep-research-exercised`, seven of the nine nodes join, `invokes_model` goes from one relation to
six and `calls_tool` from none to one, and `configured-tool-has-no-caller` stops firing on a tool the same
run showed being called. Ten spans are still declined, and that number is the guard on the other half: the
compiled graph, the two subgraph loops and the three runnables inside one node all name nothing.

**Five relations arrive that this application declares nowhere, and the reading that produces them stands.**
A node whose implementation is a subgraph nests that subgraph's nodes inside itself, so an agent span
contains another agent span, and 0.7.0 settled that a nesting between two agents is `hands_off_to`. That
branch is load bearing where it was argued: the demonstration system declares exactly that relation between
its orchestrator and its workers. Here the same reading calls a subgraph a transfer of control to a node the
subgraph is made of, and `hands_off_to` goes from eight relations to thirteen with none of the five joining
anything.

**Keeping it is a decision and it was made deliberately.** Nothing is bought by calling it containment:
`contains` is agent group to agent on the declared side, so a relation between two nodes would join nothing
either way, and the report would trade five relations a reader can question for five a reader cannot see.
What the trace shows is that one node's work happened inside another's, and on this dialect it cannot show
whether that is a node delegating to a peer or a node built out of one. The count is what goes quiet if the
reading is changed without saying so, which is why `open-deep-research-exercised` holds it.

**The two that do not join are the point.** That repository declares `supervisor` and `supervisor_tools`
twice, once in the deep researcher graph and once in the legacy one, so the adapter disambiguated both and
a run naming a bare `supervisor` cannot say which it ran.

`joins.ambiguous` had one producer before this, and the two are not the same case.
`pydantic-ai-exercised` reports `agent` because ninety eight declared agents in that library's examples are
each named `agent`, and no run could ever pick one of them. Here there are two, they are in one
application, and the run names the subgraph that contains the node it ran, which is a tie a later change
could break. Refusing to guess is right either way and it is what this entry pins.

`openai-cs-agents-demo-exercised` does not move, which is the control: that instrumentor writes no
`metadata` attribute, and its wrapper spans still decline.

## 0.7.0

Released 2026-08-20 from npm as `orchescope@0.7.0`, published locally with `npm publish --no-provenance`,
so this release carries no registry attestation. `pnpm package` builds from this tag a tarball byte
identical to the one on the registry, which was checked by downloading the published one and comparing:

```
sha256  04aaf71e623d9eb119b88e6e08b86a295311da8cda40de5bbd4fa03ccc2f1120
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes
match this source; it does not say who published them. npm reports correcting `bin[orchescope]` while
publishing, which is the normalisation the release guide describes and which the comparison above shows
changed no byte. Installed from the registry the binary reports `0.7.0` and `orchescope doctor` passes
every required check, which is the one that matters: the parsers resolve a native binding and a
WebAssembly grammar relative to their own package directories, and only a real audit from an installed
tree proves those resolve.

**No published document changes.** `packages/schema` and `schemas/` are untouched, so a consumer reading
0.6.0's shape reads this one. `unattributed[].reason` gains its first producer of `no_name`, which the
schema has declared since before anything wrote it.

**What moves is what a report says about a system somebody traced, and it moves a lot.** Every change
below came out of one run of one third party application, and each was only visible once the one before
it was fixed. A reader who has stored runs should expect their component counts, their relation counts
and their `topology-shape` answer to change; a reader with no runs sees nothing move at all, which the
corpus says plainly, since all seventeen entries that carry no run matched unchanged through every one of
these.

- A handoff the OpenAI Agents SDK performs by calling a tool is read as a handoff rather than as a tool
  nothing declared. Two components leave the graph on the pinned demonstration and two declared relations
  gain their first observation.
- The spans an instrumentation opens for its own structure stop becoming components. Three more leave,
  and what ran under them attaches to the agent that ran it, which is what let a run join relations an
  application declares. A run of six spans that had reported no relation at all now reports two.
- A nesting is called a handoff only where both ends are agents. An evaluator running the agent that
  implements it is containment, and calling it a transfer of control reported one that never happened.
- Reachability, entry points, cycles and coordination fan out stop reading relations that only a run
  produced. Until this, auditing a commit with a run in the project and auditing it without gave two
  different answers about the declared architecture, and the second was the tracing library's.

**Finding counts will move where runs are stored.** On the pinned customer service demo,
`exercised-not-declared` goes from naming seven components to naming two, and both of the two are models
that repository genuinely pins nowhere. `topology-shape` goes from naming one unreachable component to
naming seventeen, which is what the same commit reports with no run in it and always has.

The corpus grew the measurement that would have caught the last of those. `findings.byRule` counts
findings, a rule that groups its occurrences reports one finding whatever it found, and reachability
swung by eighteen components across three changes without moving a single number in any expectation file.
`findings.componentsByRule` is recorded beside it now.

### What each rule names, which the corpus could not see

The three changes above moved `topology-shape` from naming one component to nineteen and back to
seventeen, and every number in every expectation file stayed still for all three. `findings.byRule`
counts findings, a rule that groups its occurrences reports one finding whatever it found, and there was
nothing else to look at. A rule whose answer can swing by eighteen components with no diff is the silence
the corpus exists to break, so it now records `componentsByRule` beside it.

Nothing moved when it was recorded: twenty files, a hundred and thirteen insertions and no deletion. What
it buys is an invariant the corpus was already holding both halves of and never compared. Three entries
pin the same commit twice, once scanned and once scanned with a run, and a rule about the declared graph
has to answer both the same way. All three now read 23, 12 and 5 on either side. Before the change above,
the first pair read 23 and 25.

### A question about the declared topology stops reading what only a run produced

`topology-shape` reports fan out, reachability and cycles "in the declared control flow", every draft it
cuts carries `basis: discovered`, and the components it considers are filtered to `presence.static`. The
traversal underneath read every relation in the graph, including the ones reconciliation could match
against no declaration.

So the declared answer depended on whether anyone had traced the system. On the pinned customer service
demo, scanning the commit reported seventeen components unreachable and scanning it with a run in the
project reported one, and the one was the tracing library's: the instrumentor opens a span for the trace
it wraps a run in, nothing pointed at it, so it qualified as a root and reached the whole agent graph
through relations only that run produced. Reading a wrapper as a component is fixed above; that fix took
the false root away and left the true disagreement showing, at nineteen against seventeen.

`partOfDeclaredTopology` is the one predicate that answers it, beside `partOfAuditedSystem` and for the
same stated reason: the delta, the coverage fraction and every rule about the declared shape ask the same
question, and a graph answering it one way for one of them and another way for another is how the
contradiction arrived as a finding. `entryPoints`, `unreachableComponents`, `controlFlowCycles` and the
fan out degree route through it, and so do the two places in the delta that spelled it inline.

**`reachableFrom` keeps following everything, and that is deliberate.** Its other caller asks what model
driven control can reach, which feeds the approval boundary rule, and there a relation a run produced is
evidence that control did reach. Dropping it would make a safety rule quieter than its evidence. The
predicate is the caller's argument rather than the function's policy.

What this is checked against is an invariant the corpus was already holding the halves of. Three entries
pin the same commit twice, once scanned and once scanned with a run, and `topology-shape` is about the
declared graph, so the two have to agree. `pydantic-ai` and `vercel-ai-chatbot` agreed already.
`openai-cs-agents-demo` did not, and now does.

`DegreeStats` loses `outDegree` and `inDegree`, which nothing has ever read. Leaving them would have
meant one field on that type counting declared relations and two counting every relation.

### A nesting is a handoff only between two agents

The third thing that traced run found, and the one the two fixes above made impossible to miss. A span
nested inside another was read through the child alone: a span that contained an agent span was a
`hands_off_to`, whatever had contained it. So the guardrail, whose implementation is an agent of the same
name, produced `hands_off_to` from `evaluator:relevance-guardrail` to `agent:relevance-guardrail`, which
reads as a component handing off to itself, and a transfer of control that never happened was reported as
exercised beside the two that did.

Reading the child alone is right for every other kind, because what a nesting means is settled by what
was nested: a span that contained a tool span called that tool. An agent is the exception, because what
it means to run an agent depends on what ran it.

**One agent's span containing another's stays a handoff, and that branch is load bearing.** The
demonstration system declares `hands_off_to` from its orchestrator to each of its workers and its run
nests the worker inside the orchestrator, so that is the branch which joins the two, and a test now says
so. Anything else that contains an agent span merely ran it, and `contains` is what that is: containment
is what was observed, and it stays out of the control flow projection, where a relation this build could
not name has no business contributing a cycle or a fan out.

`openai-cs-agents-demo-exercised` moves two relations from `hands_off_to` to `contains` and nothing else
moves, on any entry. Notably `topology-shape` does not: those two agents are still not entry points,
because containment disqualifies a root exactly as a transfer does. That the number did not move is the
point, since the edge kind was not chosen to move it.

### The spans an instrumentation opens for its own structure

The same traced run, and the larger half of what it found. The OpenAI Agents SDK's instrumentor opens a
span for the trace it wraps a run in, named `Agent workflow`, and one per iteration of the agent loop,
named `turn`. Each carries an OpenInference kind and no other attribute at all. Read as components they
became `agent:agent-workflow`, `agent_group:agent-workflow` and `agent_group:turn`, reported at medium
severity as three parts of the system that ran undeclared, which no reader could act on because there
was nothing in the repository to declare.

**The noise was the cheap half.** Every relation the run observed hung off a wrapper rather than off the
agent. The run said `turn` called `update_seat`, `turn` invoked both models, `turn` ran both guardrails.
So the declared `calls_tool` and the twelve declared `validated_by` relations had nothing to join, and
not one of the forty two relations that application declares had ever been reported as exercised.

**What settles it is that the span names nothing.** Every agent span in that run carries `agent.name` and
`graph.node.id`; the two wrappers carry neither, and no chain span carries `gen_ai.workflow.name`. A span
name is a name only where a convention says so: the generative AI conventions specify `{operation} {name}`
and are read that way, and OpenInference specifies nothing of the kind, so a span there carrying a kind
and no name has said that something is nested here and nothing about what. Minting a component from it
means inventing one out of the instrumentation's own label.

Only the two kinds whose whole content is a name are asked. A `GUARDRAIL` span in that same run carries
exactly what `turn` carries, one attribute naming its kind, and its name is the guardrail's own: this
build has never read an attribute for an evaluator's name, so there is no absent name to notice, and
declining would drop an evaluator that joins. That near miss is a test.

Declining is stated rather than silent. Each one is counted in the topology's `unattributed` as
`no_name`, which is a reason the schema has declared since before anything produced it.

**A span that is no component no longer ends the chain.** A relation is drawn to the nearest component
that enclosed the work, and severing at a span this build could not read loses a relation the run does
show. That was costing more than the wrappers: the AI SDK opens a step span around every model call and
every tool call an agent makes and labels it `gen_ai.operation.name: agent_step`, which this build does
not read, and `vercel-ai-chatbot-exercised` is a recorded run of six spans that reached a model and a
tool and reported **no observed relation at all**. It now reports both.

On `openai-cs-agents-demo-exercised` the three wrappers are gone, what ran undeclared drops from five
components to the two models the demo genuinely pins nowhere, and the run joins the declared
`calls_tool` from the seat agent to `update_seat` and both declared guardrail relations. `invokes_model`
goes from two relations to four, because a model call is now attributed to the agent that made it rather
than to the turn it happened in. `pydantic-ai-exercised` opens no wrapper span and does not move, which
is the control.

**One number moved a long way and it is worth reading.** `topology-shape` went from one component
unreachable to nineteen. The demo's declared handoffs are fully cyclic, so no agent has an inbound
relation to spare and none of them qualifies as a root; the scan without a run has reported seventeen
unreachable for as long as that entry has existed. The exercised entry reported one because
`agent:agent-workflow` had nothing pointing at it and served as the root that reached the whole graph.
**A tracing wrapper was supplying the answer to a question about the declared topology**, so auditing
that commit with a run and without it gave two different architecture answers. They now differ by two
rather than by sixteen, and the remaining two are the guardrail agents, which a runtime only relation
still disqualifies as roots.

### A handoff the instrumentor recorded as a tool call

The section below deferred this rather than guessing at it, and what closed it is that the guess was
never necessary. The OpenAI Agents SDK performs a handoff by calling a tool, and
`openinference-instrumentation-openai-agents` faithfully records a tool, so a run of an application
whose declared graph is full of handoffs exercised none of them and exercised two tools nothing
declared instead:

```
name:                     "handoff to Seat and Special Services Agent"
openinference.span.kind:  "TOOL"
input.value:              "Triage Agent"
output.value:             "Seat and Special Services Agent"
```

**The span name is corroboration and the attributes are the test.** A repository may call a tool
whatever it likes, so `handoff to` settles nothing on its own. What does settle it is a tool span that
names no tool, whose input and output are both names the same run reported as agents: control passed
from the first to the second, and both ends are already components, since a name appearing only inside
those two attributes names nothing the run can show ran. A span that does name a tool is a call to that
tool whatever its arguments say.

That is a fact about a run rather than about a span, which is why it is derived in
`packages/traces/src/topology.ts` beside self time, parallelism and retries, and not where one span is
classified. The stored span keeps the operation the instrumentor's attributes give it.

**A transfer becomes a relation and never a component.** The span names both ends, so the relation is
drawn between the two agents rather than out of whatever the parent span happened to be, which on this
SDK is the turn the handoff was decided in. The time the transfer took is attributed to the edge, which
is the only thing it can honestly be attributed to.

On `openai-cs-agents-demo-exercised`, `tool:to-seat-and-special-services-agent` and
`tool:to-triage-agent` are gone from what ran undeclared, the run's two transfers join the declared
`hands_off_to` relations instead of adding relations of their own, and the run reports two handoffs and
one tool call where it reported none and three. Nothing else in the corpus notices: the two hermetic
exercised entries emit no `input.value` at all.

The spans are pinned verbatim in `packages/traces/test/openai-agents-handoff.test.ts`, alongside the
three cases that have to stay tools: a span that names its tool, a span where only one of the two values
names an agent, and a span named `handoff to` in a run that reported no agent at all.

### A handoff written after the agents exist

The second defect the first traced run found, and it turned out to be larger than it looked. The run of
the pinned customer service demo reported handoffs the graph had never heard of, and the reason was not
that the run named them oddly. The repository declares sixteen handoffs and this build read none of them.

`Agent(handoffs=[...])` can only name peers that already exist, so a set of agents that hand off to one
another cannot be written that way. That demo constructs its triage agent with `handoffs=[]` and assigns
five on the next line, then appends and extends onto five more:

```
triage_agent.handoffs = [flight_information_agent, handoff(agent=booking_cancellation_agent, ...), ...]
faq_agent.handoffs.append(triage_agent)
seat_special_services_agent.handoffs.extend([refunds_compensation_agent, triage_agent])
```

**The fact model had no assignment in it at all.** Appending and extending are calls and were already
recorded; a value written onto a member was recorded nowhere, in either language. `ModuleFacts` carries
`assignments` now, holding the dotted target and the value reduced the way a call argument already is, so
a list, an identifier, a call or a literal all arrive in the shape every adapter can already read. Only a
member target is kept, because a plain `x = ...` is already a variable definition and recording it twice
would say the same thing twice.

All three spellings are read, and each item is either the agent itself or `handoff(agent=..., ...)`, which
names its destination in an argument rather than being one. The two analysers are checked against each
other on it, since the claim that one fact model covers both languages is what lets one adapter read them.

`openai-cs-agents-demo` goes from no handoff to fifteen, and `topology-shape` reports five cycles in the
declared control flow, which that application genuinely has: triage hands to the specialists and every one
of them hands back. `openai-agents-python` goes from 53 to 73 and `openai-agents-js` from 26 to 28, all of
them assignments in their own tests and examples.

**What this does not close is the thing that was reported.** The run still reports
`tool:to-seat-and-special-services-agent` and `tool:to-triage-agent` as exercised and undeclared, because
the SDK performs a handoff by calling a tool and the instrumentor records that as a tool: the span is named
`handoff to Triage Agent`, carries `openinference.span.kind: TOOL`, and names the two agents in
`input.value` and `output.value`. Reading it as a handoff means deciding that a span name beginning with
`handoff to` is a handoff, which is an inference from a naming convention, and this build's whole
discipline is to be careful about those. It is a decision rather than a fix and it is recorded as one.

### A guardrail the repository declares, and the agent it protects

The first traced run of a third party application found this on its first attempt. The graph held
`agent:jailbreak-guardrail`, declared and exercised, beside `evaluator:jailbreak-guardrail`, which only
the run produced, and the same pair for the relevance guardrail. Reconciliation matches on kind and name,
the kinds disagreed, and one guardrail became two components with the run's half reported at **high**
severity as having executed undeclared.

Neither side was wrong about what it saw. The repository states the role plainly, three times, and this
adapter read past all of it:

```
guardrail_agent = Agent(name="Relevance Guardrail", ...)     # read
@input_guardrail(name="Relevance Guardrail")                 # ignored
input_guardrails=[relevance_guardrail, jailbreak_guardrail]  # ignored
```

`@input_guardrail` and `@output_guardrail` are read now, as `evaluator` components, and
`input_guardrails` and `output_guardrails` as `validated_by` relations from the agent to what checks it.
The two lists are read separately, because what guards an input and what checks an output are different
claims about the same agent. `evaluator` is the kind because it is what a run calls this, and agreeing
with the run is the whole point.

The agent a guardrail runs stays a separate agent. A repository declares two things here, a decorated
function and the agent that function runs, and on the pinned demo both carry the same name; collapsing
them would trade one wrong answer for another.

On `openai-cs-agents-demo` both guardrails now join instead of being accused: exercised goes from 5 of 22
to 7 of 24, `validated_by` from 2 relations to 14, twelve of them read from source where the run had
supplied the only two. The high severity finding is still there and it is now about the two models, which
genuinely are undeclared because the demo pins none. A wrong high finding was replaced by a right one.

On `openai-agents-python`, the SDK's own repository, 48 evaluators appear and 46 of them are in its test
suite, marked and left out of what the rules judge. The two the repository ships are `math_guardrail` and
`sensitive_data_check` in `examples/agent_patterns`, each joined to the agent that declares it.

Only the Python spelling is read. The JavaScript SDK declares a guardrail as an object rather than
through a decorator, so `openai-agents-js` does not move, and an agent there that names a guardrail this
build cannot resolve draws no relation rather than a guessed one.

`evaluator` and `validated_by` both gain their first producer that reads source rather than a trace, and
move out of the table in `tests/e2e/rule-input-producers.test.ts` that records what only a run can write.

### An expectation cannot pin what a provider will not reproduce

Measuring that fix twice showed the entry moving on its own. `latency-concentrated-in-one-component` put
one model at 42 percent of measured time and then at 62 percent, which is `low` and then `medium`, with
nothing in the repository changed. A corpus exists so that a diff means something, and an entry that
manufactures one on every run teaches a reader to skip the diff this file exists to make them read.

An observation no longer pins `findings.bySeverity` where the entry declares `requiresEnvironment`, which
is exactly the entries that reach a provider. Only the band is dropped: `byRule` was identical across
both runs and stays pinned, so an entry that stops firing a rule still fails, and that is the half a join
is measured on. The two hermetic entries drive an offline model, reproduce a duration as well as a rule,
and keep both.

Checked by running the entry against a live provider twice in a row. Both matched.

### The join, on an application, with a provider actually called

The two entries that carried a run before this one are hermetic by design: each drives its library's own
offline model, so neither needs a credential and neither costs anything. That is the right property for a
corpus entry and it is also a limit. An offline model answers from a schema in one turn, so it never hands
off, and the handoff is the relation an agent application exists to demonstrate. Ten spans, both from
drivers written here, and no handoff among them.

`openai-cs-agents-demo-exercised` is the same pinned commit as the entry beside it, measured with a run.
Twenty six spans, more than the rest of the corpus together. The triage agent hands off to the seat agent,
which calls `update_seat`, with two guardrails running around it, and it answers "Your seat has been
changed to 14A for confirmation IR-D204". Five components are declared and exercised on code this
repository did not write: both guardrails, the triage agent, the seat agent and the tool.

The SDK carries its own tracing, which exports to OpenAI's platform rather than over OTLP, so the spans
come from `openinference-instrumentation-openai-agents`. It emits `openinference.span.kind`,
`llm.model_name` and `tool.name`, which `packages/traces/src/attributes.ts` already decoded. Nothing here
was changed to read them, which is the first evidence that the OpenInference reading was worth having.

**It cannot be hermetic and that is stated rather than discovered.** An exercise may now declare
`requiresEnvironment`, and a machine without those variables skips the entry with the reason printed
instead of failing inside somebody else's SDK. `pnpm corpus --exercise` without an `OPENAI_API_KEY` reports
nineteen measured and one skipped, and says which.

**The run found two defects, and the expectation records them rather than hiding them.** A guardrail is
counted twice: the graph holds `agent:jailbreak-guardrail`, declared and exercised, beside
`evaluator:jailbreak-guardrail`, which only the run produced, and the same pair for the relevance
guardrail. Discovery reads a guardrail as an agent, the run reports it as an evaluation, reconciliation
matches on kind and name, so the kinds disagree and one thing becomes two. It is what fires
`exercised-not-declared` at high severity, telling a reader something ran undeclared that is declared a
few lines away. And a handoff arrives as a tool call: the run produced `tool:to-triage-agent` and
`tool:to-seat-and-special-services-agent`, because the SDK performs a handoff by calling a tool named for
its destination, while the repository declares a `hands_off_to` relation. The two never meet.

Neither is fixed here. An expectation written to agree with a defect is how a corpus stops being a
measurement, so both are named in the entry's `why` and both are what the next cycle starts from.

Two rules fired on third party runtime evidence for the first time,
`tokens-concentrated-in-one-component` and `latency-concentrated-in-one-component`, and both are on the
list `packages/findings/test/audited-population.test.ts` records as unmovable by a declaration. A run is
what moves them.

## 0.6.0

Released 2026-08-19 from npm as `orchescope@0.6.0`, published locally with `npm publish --no-provenance`,
so this release carries no registry attestation. `pnpm package` builds from this tag a tarball byte
identical to the one on the registry, which was checked by downloading the published one and comparing:

```
sha256  56ef9101c2bf664a5fbc7bdd0d3acbb07a937e69296d7bca05d004bee9b9cf38
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes
match this source; it does not say who published them. Installed from the registry the binary reports
`0.6.0` and `orchescope doctor` passes every required check, which is the one that matters: the parsers
resolve a native binding and a WebAssembly grammar relative to their own package directories, and only a
real audit from an installed tree proves those resolve.

This release is one defect followed to the end. Something reads a field, a kind or an invariant; only
some of the producers write it; nothing errors. The rule reports `not_applicable`, the adapter reports
`componentsFound: 0`, the goal reports not validated, and the answer is too quiet in a way only a
stranger running the product on their own repository ever notices. 0.5.0 added the first three checks
that ask whether the shape is present. This one generalises them, and everything below except the corpus
entries is something those checks found rather than something a person reported.

**Finding counts will move on any repository whose tests declare agents, and the exercise fraction has
changed what it divides by.** A component every source location of which is a test file is discovered,
marked, and left out of the populations the rules judge. On the frameworks this build reads that is most
of the graph: 835 of 903 `pydantic-ai` components, 448 of 526 on `langgraph`, 302 of 323 on `crewai`. On
one application built with pydantic-ai it was ten of the sixteen agents reported. Nothing leaves the
graph, and `coverage.componentsDeclaredInTest` says how many were set aside.

**Six published documents change and one of them takes something away.** `Component.declaredInTest`,
`Edge.declaredInTest` and `coverage.componentsDeclaredInTest` are new and optional, so a consumer reading
the old shape is unaffected; `coverage.adapters[].ecosystem` became `.languages` and `coverage.filesTracked`
arrived earlier in this series. And `project`, `worker` and `guardrail` are gone from `ComponentKind`.
Nothing has ever written one of those, so no document that exists stops validating, and a manifest
declaring one is refused where it was accepted and ignored.

The corpus is nineteen pinned repositories where 0.5.0 had thirteen, and `pnpm corpus --exercise` passes
for the first time since before 0.2.0.

### The delta answered with the harness

Option three put the filtering where the question is asked, which meant eight populations decided one at
a time by hand. Deciding them by hand is fine; leaving nothing to check them is how this defect class
works. So every rule the engine evaluates is now asked the same question: one system written twice, once
where a system lives and once where its tests live, and each rule has to answer the second exactly as it
answers a repository that declares nothing at all.

It found the population nobody had decided. The reconciliation delta never asked whether a component
belongs to the system under audit, so on `pydantic-ai` with a run in it, 871 of the 958 components in the
exercise fraction were declared in a test file and `declared-not-exercised` named some five hundred
fixtures as declarations no run had reached. That is the centre of this product, the delta between what a
repository declares and what a run exercises, answering with the framework's own test suite.

`observableComponents` asks both halves now. `isObservableKind` says whether a kind can appear in a trace
at all, which is what keeps a prompt and an entry point out of a coverage fraction; `partOfAuditedSystem`
says whether the repository ships the thing. The invariant was already in one predicate, and this was the
one population that had never been routed through it.

One pinned number moves and both halves of it get more honest. `pydantic-ai-exercised` reports 1 of 86
components exercised where it reported 2 of 957. The denominator loses 871 fixtures. The numerator loses
one: `model:test`, declared in `tests/ext/test_langchain.py`, which is the library's own offline model. A
run really did reach it, which is why it stays in the join summary, and it is not part of the system that
repository ships, which is why it is not inside a fraction about that system. `tool:customer_balance` in
`examples/pydantic_ai_examples/bank_support.py` is the one that remains.

The check enumerates `DEFAULT_RULES` and covers eleven of the twenty three rules. The other twelve are
listed with the reason each is unmovable by a declaration, and the list is asserted exact: every one is
keyed on what a run measured, on a benchmark or on a chaos suite, and a fixture is precisely the thing no
run reaches. The delta it is built from comes from `computeDelta` rather than a literal, because a hand
written delta would have agreed with whatever the author believed and the defect was in the delta.
Reverting the one line above fails this on two rules.

Nothing else moves across the nineteen pinned repositories.

### Three component kinds nothing could produce

`worker` was found by the check in the section below and recorded there as a defect nobody had closed.
Closing it turned up two more, and turned up why one check had not seen them.

**This removes `project`, `worker` and `guardrail` from `ComponentKind`, which is the sixth published
document change since 0.5.0 and the only one so far that takes something away.** No stored document can
contain one, because nothing has ever written one, so nothing that exists stops validating. A manifest
declaring one of the three is now rejected, and none of the documented manifests does.

The check that found `worker` reads the four rule files, and it could not see the other two because a
rule delegates. `topology-shape` asks `unreachableComponents` which components participate in
reachability, and `observability-coverage` reads a rate whose denominator `delta.ts` builds from
`isObservableKind`. `worker` and `guardrail` were both in that second set, so the exercise rate on every
repository was computed over a population described in part by kinds nothing could put in it, and
`project` was in the guard that keeps a component out of the unreachable population. Three sets claiming
a coverage this build does not have, and no reader could tell, because a filter that never matches looks
exactly like a filter with nothing to match.

So the check reads the graph analysis a rule reaches through, and not only the rules. That is what makes
this a closed class rather than three fixed instances: it now asks the same question of the vocabulary a
rule delegates to, and the table of values nothing writes is empty with an assertion that it stays empty.

Extending the reading surface also asked about five relation kinds the fixture had never produced. Two
of them, `hands_off_to` and `publishes_to_queue`, a scan produces and the fixture simply did not, so it
declares a graph and writes to a queue now. The other three, `reads_memory`, `writes_memory` and
`performs_side_effect`, only a run produces, and they are recorded beside `guarded_by` with the reason.

A worker was already in the model without this kind, as an agent whose `details.role` is `worker`, which
is what CrewAI, LangGraph, the OpenAI Agents SDK and the Vercel AI SDK all write. `project` and
`guardrail` named nothing at all. Nothing moves across the nineteen pinned repositories.

`falls_back_to` is a relation kind nothing produces and it stays, because nothing reads it either. A
vocabulary entry with no producer and no reader costs a reader nothing; one with a reader is a claim.

### A repository that is about agents and declares none

The three `not_agent_system` entries were Flask, Express and axios: general purpose libraries with
nothing to do with agents. They catch a reader that matches on the vocabulary of the domain, and they
say nothing at all about the harder case, which is a repository that really is about agents and is
still not one.

`langchain-ai/open-agent-platform` is that case. It imports `@langchain/langgraph-sdk` in twenty one
places, holds an MCP client in `use-mcp.tsx`, and declares no graph: no `StateGraph`, no
`createReactAgent`, no node added and nothing compiled, because the graphs it talks to and the servers
it connects to run somewhere else. It is a client on both axes.

What decides the entry is that `adapter:langgraph` applies here, inspects twelve files, and produces
nothing. The ceiling is twenty six components, every one a database, an entry point or a service the
effect reader found, and no agent system detected. A reader widened until an import or an SDK type is
enough moves that zero, and this is the entry that says so.

Both blind spots it reports are true of this build and stay in the expectation. `@modelcontextprotocol/sdk`
is imported to build a client, and the MCP adapter reads configuration and the call sites that declare a
server; `@langchain/core` is imported for message and document types. Neither is a claim this build makes
and fails, and an adapter that starts claiming either has to move the entry.

### Two pinned repositories nobody had measured since before 0.2.0

Sixteen of the eighteen corpus entries are measured by `pnpm corpus`. The other two need `--exercise`,
because they install an environment and run third party code to produce spans, and they are the only
entries that measure the declared against exercised join on code this repository did not write. That
join is the centre of this product. `pnpm corpus` skips them and prints the skip, `pnpm verify` runs
the offline subset, the release checklist named neither, and so nothing ran them. Their expectations
were last recorded at `51ce695` on 2026-07-27: ninety five commits and four releases ago.

The commit that froze them is the commit that recorded them. `51ce695` taught the effect reader to
leave a test harness out of the graph, re-recorded every measured entry, and could not re-record these
two, because recording them needs the flag. Everything since piled onto that, so
`pydantic-ai-exercised` still claimed 562 effect components where the reader now finds 33, 241 entry
points where it finds 15, and 97 queue consumptions where nothing produces one.

One number in the difference looks like a regression and is a fix. `exercisedComponents` falls from 3
to 2 on one entry and from 3 to 1 on the other, while the set of declared components each run actually
joined is unchanged. The old counts are that set plus the components the run named and nothing
declared: two plus one, and one plus two. `97492b7` took undeclared components out of that fraction on
2026-08-11 for exactly that reason, and these two files still held the number from before it.

What each entry records is checked against its own sibling rather than against a baseline four
releases old, which is the only comparison worth making here: an exercised entry is the entry beside it
plus one run. Outside the runtime block `pydantic-ai-exercised` differs from `pydantic-ai` by the one
agent its run named and nothing declared, the two relations drawn to it, and three findings only a
reconciliation produces, one of which is `observability-coverage` ceasing to report that no run exists.
`vercel-ai-chatbot-exercised` differs from `vercel-ai-chatbot` by two such components and four
findings. Each total is its sibling plus exactly the components in `exercisedNotDeclared`, and nothing
else moves in either.

`pnpm corpus --exercise` is in the release checklist now, and not in `pnpm verify`: a gate that runs on
every change should not install an environment and execute third party code, which is the reason it was
in neither.

### A component only a test declares

The invariant that a developer's tooling is not the system under audit already existed here, in
`partOfAuditedSystem`, written when a `.mcp.json` naming somebody's editor server was read as a
declaration and the reachability rule then raised a finding because nothing in the repository could
reach it. Four adapters out of thirteen honoured it. The other nine were most of the graph.

Measured, per adapter, components whose every source location is a test file: `pydantic-ai` 835 of
903, `openai-agents` on its Python repository 662 of 899 and `mcp` beside it 54 of 71, `langgraph` 448
of 526 in Python and 410 of 505 in JavaScript, `crewai` 302 of 323. The same adapter reads the
JavaScript OpenAI Agents repository at 36 of 425, so this is not a property of an adapter but of what
a framework's own tests do, which is instantiate the framework.

It is not only frameworks. `pydantic-deepagents`, an application, reports sixteen agents and ten of
them are in `tests/`: three copies of one `_make_test_agent` helper, four called `agent`, and two that
are local variables in a test about teams, named `kwargs` and `team`. None of the ten carries a single
relation. The headline that repository prints is `this scan found 16 agents`.

**They are marked rather than dropped.** A test that declares an agent has declared one, and a count
that silently omits it answers a question nobody asked. `Component.declaredInTest` and
`Edge.declaredInTest` are new optional fields, present only where true; `coverage.componentsDeclaredInTest`
says how many; and the terminal document carries a `set aside` row beside the gaps, because a reader
who sees sixteen agents named above and six judged below is owed the difference. **That is three
published document changes, the third, fourth and fifth since 0.5.0** after
`coverage.adapters[].languages` and `coverage.filesTracked`. All three are optional, so a consumer
reading the old shape is unaffected and no document version moves.

The mark is derived where the source locations from every adapter meet, in the graph builder, and
never in an adapter. Either half asked alone gives the wrong answer: a fixture read on its own says
the system does not declare the component, and the module it exercises read on its own says no test
does. Deriving it centrally is also what stops this being honoured by nine adapters next time, and a
check enumerated from the registry now scans each adapter's fixture twice, once where the system lives
and once where its tests live, with the first scan proving the second is measuring something.

The thirteen reach the invariant two ways and both are right for what they read. An adapter that would
record a false fact still declines to read the file: a test harness reaches the same clients the system
reaches and it reaches them at fakes, so a `FakeD1` over `node:sqlite` is not a database the repository
has. An adapter that would record a true fact about something out of scope reads it and marks it.

**A narrowed population is worth less than nothing if the rule then reports the wrong reason for the
emptiness.** `configured-tool-has-no-caller` said "no tool was discovered", which is false on
`langgraph`, whose only three tools are `get_weather` doubles under `libs/prebuilt/tests`. It now says
three were discovered and a test file declares every one of them. The first version of that sentence
derived its count as the whole population minus the audited one and was wrong on the first repository
it met: on `gpt-researcher` the one source declined over is an MCP server from a `.mcp.json`, with no
source location at all, and the sentence blamed a test file for an exclusion no test file had anything
to do with. Fixtures are counted now, and the cause is claimed only where it accounts for the whole
emptiness.

Three pinned repositories move and every line of the diff is a finding, since nothing leaves the graph.
On `langgraph` `prompt-injection-boundary` stops firing: its two interpolating prompts are Docker
configuration templates in `langgraph_cli/config.py` and all three untrusted sources it joined them
against are those `get_weather` fixtures. `configured-tool-has-no-caller` goes from `clear` to
`not_applicable` there for the same reason, which changes no finding count and does change what the
rule claims to have checked. On `pydantic-ai` the unreachable half of `topology-shape` goes, and all
thirty six components it reported are MCP fixtures in `tests/mcp_server.py`, `tests/test_mcp.py` and
`tests/example_modules/mcp_server.py`. On `gpt-researcher` `prompt-injection-boundary` stops firing
because its only untrusted source is that editor's MCP server, which is the pre-existing exclusion
reaching a rule that had never consulted it.

Where the rule keeps firing it says something a reader can use. `configured-tool-has-no-caller` on
`openai-agents-python` went from 228 of 318 tools with no caller to 14 of 78.

`components.declaredInTest` is pinned in the corpus, because the totals do not move when the marking
does and a marking that quietly stopped working would otherwise show as nothing at all.

### Every value a rule reads, and the thing that writes it

0.5.0 added a check that reads the relation policy fields out of the schema and asserts a scan can
produce each one. It found `concurrency` within minutes of first running, and it covered one of the
five ways a rule selects on anything. This is the other four: component kinds, relation kinds, the
metadata keys a rule matches on, and the fields of `details` it filters on, across every rule the
engine evaluates rather than the static ones alone.

Both halves are measured rather than listed. What a rule reads comes out of the rule's own source,
asked against the enumerations the schema declares, so a rule that starts selecting on something new
is a rule this asks about without anyone remembering to add it, and the files it reads are checked
against the engine's own list of rules, so a family written in a file nobody named fails here rather
than going unread. What a scan can produce comes from scanning a repository where nine adapters apply
at once, because a name found by grep proves that something mentions the value and not that anything
writes it. `deduplicatesAtSink` and `timeoutDeclaredAt` are what makes that distinction worth the
fixture: both have a producer in source, and no pinned repository triggers either, so a check that
took the corpus for its denominator would have reported two producers missing that are not.

The residue is three tables and each entry names what writes the value instead. Two are written by a
run and not by a scan: `guarded_by`, which a span reports when an approval was passed, and
`observedSideEffect`, which reconciliation writes from an effect that happened. One is declared by a
person, `requiresApproval`, for the reason the narrower check already recorded.

**It found one on its first run, and that one was in the third table.** `worker` is a component kind
nothing anywhere produces, and `topology-shape` counts it among the kinds that participate in
reachability. The frameworks read here model a worker as an agent whose `details.role` is `worker`,
which is what CrewAI, LangGraph, the OpenAI Agents SDK and the Vercel AI SDK all write, and a
Cloudflare Worker reaches the graph as the bindings it declares. No answer was wrong, because no
component could carry the kind and so the filter never matched, which is exactly why nothing had
noticed: a claim of coverage with nothing behind it rather than a wrong number. The section above
closes it, and two more the same shape that this check could not yet see.

Nothing moves across the pinned repositories. `packages/discovery` is pinned as a `not_agent_system`
entry and counts this repository's own files, so moving the narrower check out of it to sit beside the
one that proves a rule clearable took its count down by one, and the per adapter check the next section
adds put it back. Its ceiling of zero components is unchanged.

### Three applications in the corpus, where there was one

The corpus pinned six frameworks and one third party application. Every field report so far has been an
application, which is the plainest available explanation for why they kept finding things thirteen pinned
repositories did not: the frameworks are measured continuously and the systems built with them were not.

`gpt-researcher` is a LangGraph application at 763 files where five adapters contribute at once.
`open-deep-research` is 45 files carrying a LangGraph application, an Azure search client and a model call
with no declared deadline, and it is the only pinned repository that reaches a search index, so the
`retrieval` component kind now has a producer outside a fixture. `openai-cs-agents-demo` is 43 files whose
findings were checked against the source by hand: `baggage_tool` is defined in `tools.py` and named in no
agent's tool list, so both rules that report it are right.

`pydantic-deepagents` was scanned and not pinned. It reports sixteen agents and ten of them are in
`tests/`, so what it would record today is a number a decision about test files would change.

### A prompt only a test writes

`prompt-injection-boundary` fired on 91 prompts on one field report's target, and several of the source
locations it cited were logger templates rather than prompt assembly. Measuring the population first
found something narrower and more certain than a resemblance to judge: the prompts adapter did not honour
`isTestFile`, alone among the adapters that read source. A test file is full of the one thing it looks
for, since fixtures, mocked model replies and assertion messages all read as long text with values
spliced into it.

Across the pinned corpus and the report's target, 32 of the 174 prompts this rule fired on were in test
files. On `langgraph` it was 16 of 18: the security finding there was almost entirely about that
repository's own fixtures. Prompt components fall from 2379 to 1502 across the corpus, every removal in a
test file, and the two `uses_prompt` relations `crewai` loses are both in `lib/crewai/tests`. No
repository's finding disappeared and no rule changed status, which was the thing worth checking, since a
narrowing that silences a rule costs more than the noise it removes.

`isTestFile` itself was reading one file wrong, and it mattered here because applying it would have acted
on the mistake. `spec` is absent from the directory names for a stated reason, that a directory of that
name holds schema documents at least as often as tests, and the file pattern let the same word stand
alone: `specs.ts` was a test file and `order.spec.ts` was too. One pinned repository has a
`data-schemas/src/app/specs.ts` that processes the model specifications its configuration declares, and
three adapters were declining to read it. `spec` needs a separator in front of it now and `test` does not,
because `test` carries no second meaning that stands on its own. That is the only file across fourteen
repositories whose classification changes.

What this does not fix is the rest of the population. 83 prompts remain on that target and many are still
log templates, because separating those from prompts means either filtering on length, which correlates
with nothing, or asking whether the text reaches a model, which the graph can answer for some repositories
and not for the ones that assemble prompts most carefully. Both are guesses in the direction of silence.

### A coverage rate whose denominator says what it counts

"read from 3858 of 3858 files" is completeness over the files this build parses, printed as though it
were completeness over the repository. The target it was measured on tracks 4224, so a reader was shown
one hundred percent against a whole the line never named. The denominator says `source files` now.

The documents in the difference are named too. `filesDiscovered` counts everything traversal recognised
as some language and `filesParsed` counts the source that reached a parser, so configuration falls
between the two counts and appeared in neither half of the line coverage is read from. It is a gap row
now: `185 configuration documents, not parsed as source`.

That row says what they are and not that they were read, which is the part worth stating carefully. The
expectation going in was that these are configuration this build reads through the readers that take
configuration rather than code. On the report's target the configuration reader opened none of them and
the manifest reader opened one, the root `package.json`, so claiming the population was read would have
replaced a silence with an overstatement.

The arithmetic, re-derived at `0ab3414c015bb8d4cea781b59f15237864db2239` rather than taken from the
report. 4224 files tracked: 3858 read as code and all parsed, 185 configuration documents discovered and
not parsed, `package-lock.json` skipped for exceeding the size limit, 4 Go source files reported
unsupported, and 176 in extensions the language map does not name. The report's two figures were 181 and
180; the first is right as a total and decomposes into 176 undisclosed plus 5 already reported, and the
second is 185, because the Go files and the oversized one are not inside the discovered set it subtracted
them from.

Naming the denominator cost seven columns and pushed the verbose line past eighty, where what fell off
the end was whether anything had ever run. That line sheds its verb before it sheds a fact.

**`coverage.filesTracked` is new, and it is the second published document change since 0.5.0.** It is an
optional integer, so a consumer reading the old shape is unaffected and no document version moves. It
holds how many files the index lists, absent where the root is not a checkout, because then nothing states
what the repository is and a count of what traversal happened to reach would be this build marking its own
paper. It is the only whole the counts this scan chooses can be checked against: 4224 tracked against 4043
discovered says plainly that 181 files were reached by no count in the block, 176 of them in extensions the
language map does not name and so counted nowhere else at all.

### A run that produced spans, described as producing none

The loop's count of silent runs fell back to the runs that measured nothing whenever a bundle did not
carry the partition itself. A run whose spans resolve only to a host nothing declared attributes to no
component, so it measured nothing and was read as having emitted nothing: one field report traced such a
target and the document said seven runs had recorded no span while the summary beside it said six.

Those two states send a reader to opposite places. Recorded and silent means the instrumentation never
loaded, and the answer is to make the system emit spans. Measured nothing I could attribute means the
spans arrived and named things this build does not know, and the answer is somewhere else entirely. That
is the distinction 0.4.0 exists to preserve, undone by a fallback.

A `RunRecord` carries its component metrics and no span count, so a bundle without the partition cannot
be asked which of the two happened and now says nothing rather than guessing. Such a bundle is an older
stored report; anything this build writes carries the count. The step still reports that nothing was
measured and still names `trace`, because that part was never in doubt.

`measuredRunCount` is a different question and keeps its fallback. A run that attributed nothing did
measure nothing, whatever it emitted, so it is not a baseline a goal can be judged against.

### A sentence about the graph, said as a sentence about the graph

`side-effect-approval-boundary` declined with "18 consequential operations were left unreported because
no agent, tool or MCP server in this repository reaches it". The count is true of the graph this scan
produced and the sentence was about the repository, and on the field report's target the repository wires
MCP tool calls, an approval step and a tool registry that all reach those operations. What this build
could not do was recognise the framework they are written in, which is a fact about this build.

The human headline had the same shape. It said "this project has 1 agent, 20 tools and 1 model" where
every number in it is what discovery found, so it now says "this scan found" instead. That is the same
correction the coverage block's adapter languages needed in 0.5.0: a partial reading presented as a
property of the repository.

The sweep found a third. `topology-shape` said "No entry point declared in this repository reaches this
component through control flow" and listed three causes it could not tell apart, none of which was an
entry point no adapter here recognised. It says what the scan discovered, and names the fourth cause.
The orphan tool rule was already saying the true thing and is unchanged.

The declining sentence also had two words disagreeing with two different nouns. The verb belongs to a
subject that is singular in every version of the sentence and the object belongs to the operations, so
agreeing both with the count printed "no agent, tool or MCP server reach it" whenever more than one was
declined.

Nothing moves across the thirteen pinned repositories: no count changes, only what the sentences claim to
be counting.

### A deadline a request states

`model-call-without-timeout` printed one remediation for a model behind a client and another for a model
reached by a plain request, and only the first could ever be followed. The second said to pass an abort
signal that expires to the request itself, and a request already carrying `AbortSignal.timeout(60_000)`
got the finding back: nothing on that path had ever looked for a deadline, so the field the rule filters
on was written only by the SDK reader. A field report edited two call sites, one of each shape, watched
the count move from two to one, and was told the goal had not been met.

Both ecosystems are read, because both reach a model this way and neither spells it the way the other
does. JavaScript states it as a signal that expires and Python as a `timeout` argument, and the sentence
serving one told the other to reach for something its language does not have. So the request remediation
divided in two as well, and each of the three now has a repository that fires it and the same repository
its own remediation clears.

What the syntax settles decides what is read. `AbortSignal.timeout(x)` states a deadline whatever `x` is,
since expiry is the whole purpose of that constructor, so a duration written as a named constant is a
deadline with a number this build cannot read rather than no deadline at all. A `timeout` argument states
nothing on its own, because `timeout=None` and `timeout: 0` are both how a caller asks for none, so a
literal is required. A signal from an `AbortController` is refused: what aborts it is written elsewhere,
and holding one to let a caller cancel is at least as common as holding one for a clock. The same
distinction the tenacity reading makes between a ceiling that cannot be read and no ceiling at all.

The deadline is settled per relation before any edge is written. A relation stands for every request one
function makes to one model and the builder merges two drafts for it by union, so a function that gives
one of its two requests a signal would have handed the relation a deadline covering the other.

Nothing moves across the thirteen pinned repositories: none of them reaches a model over a plain request.

### A remediation is a promise, and every branch of it is checked

Three checks were added last release to turn a rule nothing can answer into a build failure, and this
report got past all three. `tests/e2e/goal-eligible-rules.test.ts` carried one repository per rule and
the rule above prints two remediations, so the branch the fixture exercised was proved clearable and the
other one never was. The rule was answerable; the promise it printed to half its readers was not.

A rule now declares the remediations it can print, keyed by the situation each one addresses, and the
check enumerates those keys rather than being handed a list. Every key needs a repository that fires it
and the same repository that remediation clears, a case that reaches a branch is required to say which
branch it reached, and the line it quotes has to be one the finding actually prints. A branch added with
no repository behind it is a failing check.

The five goal eligible static rules declare their remediations this way, and findings carry the key they
were given as `remediationVariant`. That is metadata rather than a new field, so no published document
changes shape.

### A search index is a retrieval source

`retrieval` was a component kind nothing produced. `prompt-injection-boundary` reads it as one of the
three sources whose content nobody can vouch for, so on any repository the rule had two thirds of its
population available and a retrieval application read as one that retrieves nothing. The field report's
target is exactly that: its search results reach the prompt four lines from where the prompt is built,
and the rule reported that no source had been discovered. 0.5.0 made the rule decline instead of claiming
an all clear, which was the honest half of the answer; this is the other half.

Azure AI Search is claimed, with a fixture. An index is named for what the source names it, so two call
sites querying one index are one component, and a query through a client this build could not resolve
reaches the service under its own name rather than being dropped. A search is a read whatever the index
does internally, so it carries `read_only` and no rule asking about consequential operations reports it.
A client built in a test harness is not a retrieval source: `conftest.py` in the report's target builds
one with every field blank, which is a fixture.

On that repository `prompt-injection-boundary` now fires where it declined, naming the index and the
prompt that interpolates.

Nothing moves across the thirteen pinned repositories: none of them uses this SDK.

## 0.5.0

Released 2026-08-18 from npm as `orchescope@0.5.0`, published locally with `npm publish --no-provenance`,
so this release carries no registry attestation. `pnpm package` builds from this tag a tarball byte
identical to the one on the registry, which was checked by downloading the published one and comparing:

```
sha256  7f39e071649e2c00e161aa2ec6b22d87ba9d18b8cbaafd5e2fa371943d6deb03
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes
match this source; it does not say who published them.

This answers the fourth field report, against a retrieval application built on Azure OpenAI: 655 files,
Python majority with a TypeScript frontend. Two of its six items were withdrawn on inspection, one of
them measured against both this build and the published 0.4.0 before it was withdrawn.

**Finding counts will move on Python repositories, and the coverage block has changed shape.** Retries
declared with tenacity are discovered where none were before, so a repository that reported no retry may
now report several. Agents and models named in calls that carry a comment or a passthrough are named
rather than counted anonymously, which merges duplicates: across the pinned corpus `openai-agents-python`
goes from 620 agents to 617 and from 15 models to 18. And `coverage.adapters[].ecosystem` is replaced by
`coverage.adapters[].languages`, which is the only change here that alters a published document.

### An adapter says what it read, not what it is about

**This is the one change in this release that alters a published document.** `coverage.adapters[].ecosystem`
is gone and `coverage.adapters[].languages` is there instead. A consumer reading the old field finds
nothing; a consumer validating against `schemas/report.v1.json` or `schemas/system-graph.v1.json` needs
the new file. Nothing inside the product read the field, and no stored scan is validated on read, so an
existing `.orchescope` directory keeps working.

The field was a constant declared on the adapter. The fact model is language neutral on purpose, which
is what lets one adapter cover a framework in both ecosystems, so any ecosystem an adapter named in
advance was wrong for half the repositories it ran on: six of the twelve said `javascript`, including the
two that read `openai-agents-python` and the Python `langgraph`. A Python majority repository was told by
its own coverage block, adapter by adapter, that JavaScript had been read.

An adapter now reports the files it inspected rather than how many, and the scan reads their languages
off the paths. `model-sdk` on a Python repository says `python`, `effects` says `python, typescript`, and
an adapter that did not apply says nothing rather than naming a language it never opened.

### The checks that would have found the last four reports

Four field reports have now filed the same defect under four names, and every one of them arrived because
a person ran the product on their own repository and noticed an answer that was too quiet. Nothing here
had ever asked whether its own invariants held, so the tool's self diagnosis was being done by its users,
one report at a time.

**Every rule a goal can be cut from is now proved clearable.** A rule needs a test that fires it and a
test that proves it stays quiet without evidence, and both of those pass for a rule nothing can ever
answer: `model-call-without-timeout` filtered on a field no adapter reading source had written, so it
fired on every repository with a model call in it and no edit to any file could clear it. Each of the
five goal eligible static rules now carries a repository that fires it and the same repository with the
remediation the finding itself prints applied, run through the real command line.

It found one on its first run. `side-effect-approval-boundary` names the write a tool performs, and its
remediation says to mark the tool as needing approval, which is a different component one frame away. An
operator who did exactly what the finding asked got the finding back. A consequential operation is now
guarded when every declared caller that reaches it requires approval, walked through the frames discovery
invented and stopping at the components the repository declared. Every caller rather than any, because a
second tool reaching the same write with no approval is the whole risk.

**The relation policy fields are checked against what reading source can produce.** The properties come
from the schema rather than from a list, so a field added later is a field this asks about. It found a
second one immediately: `concurrency` is a worker option and the queue reader took its options from a
fixed argument position, which is where `new Queue(name, opts)` puts them and not where
`new Worker(name, processor, opts)` does. The only field that reader looked for was the one it could
never reach. Options are read where these libraries put them, which is last.

**The two analysers are checked against each other.** The fact model claims that `new Agent({ name })`
and `Agent(name=...)` are one shape, and that claim is what lets one adapter cover a framework in both
ecosystems. Three defects this cycle were one analyser disagreeing with the other about a shape they both
meet constantly, and each was found by accident while somebody was chasing something else. Five pairs now
assert the reduction, written the way each language writes it rather than transliterated.

`AGENTS.md` and `CONTRIBUTING.md` now ask for the third test by name.

### An address whose tail the source settles

An authority has to be finished before the first substitution, and that rule is right: reading a host out
of `https://api.` would be a confident answer to a question the source did not settle. It is a rule about
the head of an address, and it was being applied to addresses that settle the other end. The two
enterprise paths to a model are both written that way, `` f"https://{service}.openai.azure.com" `` and
`` f"https://bedrock-runtime.{region}.amazonaws.com" ``, and each reported no host at all.

A host stated around what the address substitutes is now read, as a separate reading rather than as a
relaxation of the first one. What it takes is the text written after the last thing the address computes,
and the authority still has to end in text the author wrote: `` f"https://api.openai.{tld}" `` settles its
tail no more than `https://api.` settles its head, and is refused for the same reason.

A tail is only worth a name where something knows that tail serves one thing. `example.com` is as
complete a tail as any other and naming a service after it would merge every host under a domain into one
component, so the endpoint table decides, which is what it already matches on. A repository posting to
`` f"https://api.{region}.example.com/x" `` still reports no host.

The component carries the wildcard the source implies rather than a host nobody wrote:
`*.openai.azure.com`, with the reason beside it. `serviceCalledAt` distinguished a host read whole, a same
origin request and one it could not read, and this is the fourth case rather than a pretence at the first.

Nothing moves across the thirteen pinned repositories: none of them writes a host this way.

### A retry a library declares, rather than one the code shapes

Every retry reading here worked from shape: same work each pass, a counter in the header, a wait before
the next one. Tenacity states the whole policy in its arguments and neither form it documents has a shape
to read. `async for attempt in AsyncRetrying(...)` is syntactically an iteration over an object, so each
pass looked like it took the next item, and `@retry(...)` above a function is no loop at all. The field
report's target wraps fifteen attempts with exponential backoff around its embedding and image describe
calls, and all three retry rules reported that no retry had been examined.

Both forms are read now, and what tenacity states is taken as stated: `stop_after_attempt(15)` is a
ceiling of fifteen and `wait_random_exponential` is exponential backoff, in a way that a counter called
`i` and a `sleep` of unknown growth never are. The two defaults are read the same way, because the
library documents them: a retry with no `stop` retries forever, and one with no `wait` re-attempts as
fast as its dependency can fail.

A `stop` this build does not recognise is recorded as bounded with no count. Reading it as unbounded
would accuse a repository on the strength of a spelling nobody here knew, which is the one direction a
reader cannot check.

**The retry had to be able to reach a model call.** The index of what each call site produced is
documented as complete, and the model SDK adapter had never written to it, so a retry around
`client.embeddings.create(...)` resolved to nothing: the callee is a method path no binding stands for
and the model component it produced was recorded nowhere a second reader could find. The loop was read
and the operation was not, so no relation was drawn at all. This is the same join 0.4.0 opened for a body
that makes its own request, with the model half never connected. In `pydantic-ai` it also makes the
declared `retrieve` tool in the RAG example reach the embedding call written inside it, which is one
relation nothing had drawn.

On the report's target this moves three retry rules from `not_applicable` over nothing to `clear` over
three examined retries, each carrying its fifteen attempt ceiling and its exponential wait. Two further
tenacity retries in that repository are still invisible, for a reason that is not tenacity: they wrap
`aiohttp` session requests, which no client table here claims.

### A security rule stopped reporting an all clear over a set it could not see into

`prompt-injection-boundary` joins two populations, prompts and the sources whose content nobody can
vouch for, and 0.4.0 taught it to decline over an empty first one. The second was still answering
`clear`, which says this was checked and was fine. Said about a source set the build cannot look into it
answers a question nobody asked, and it is the most reassuring word in the document attached to the least
examined claim in it. The field report's target is a retrieval application whose search results reach
`build_conversation` four lines from where the prompt is assembled, and it read here as a repository that
retrieves nothing, because no adapter in this build claims Azure AI Search.

The outcome names both populations and the limit that produced the emptiness, so a reader is told that a
retrieval client with no adapter looks the same here as a repository that retrieves nothing. Not
recognising that client is a scope limit and is now reported as one; reporting an all clear because of it
was a false statement about the repository.

There is no `clear` branch left in this rule, and none anywhere in the static policy rules: every one of
them now reports through `examined`, which carries the size of what was looked at. Either both
populations exist and each interpolated prompt is a boundary to review, or one is empty and the rule
looked at nothing.

### A deadline reaches the relation the call declares it for

`EdgePolicy.timeoutMs` is what `model-call-without-timeout` filters on, and nothing that reads source had
ever written it: the only producer in the repository was a hand written manifest. The rule fired on every
repository with a model call in it, the goal cut from it asked for a timeout at the client or the call
site, and neither answered it, because the answer had nowhere to go. A field report added `timeout=60.0`
to all five call sites its goal named, rescanned, was told nothing had changed, added it to the client
construction as well, and was told the same. This is the mirror of the defect 0.4.0 fixed in the other
polarity, where a strength could be earned only by writing the answer into a manifest, and it is worse:
an operator who does exactly what the goal asks gets `not validated`.

A model invocation now carries the deadline its own call declares, and where the client can be resolved,
the one its client declares, with the relation recording which of the two it read. The two are different
facts and a reader acting on either needs to know which they have: a timeout on the client covers every
call made through it, and a timeout on a call covers that call and leaves its neighbours undefended.

The unit is read rather than copied. The Python clients for `openai` and `anthropic` hand the value to
httpx and take seconds; their JavaScript clients take milliseconds. `timeout=60.0` had been recorded as
sixty milliseconds, which reconciliation would have read as a deadline every call it observed had
overrun.

Two limits, stated rather than guessed past. A client is resolved within the module that constructs it
and no further, so an application that builds its client once and hands it to whatever needs it gives the
call site no route back and the relation carries nothing. And a relation standing for several calls
claims a deadline only when every call it stands for declares one, because a function that times one of
its two calls has not given the relation a deadline.

### A goal is judged against the risk it was cut from

`model-call-without-timeout` answers a repository where every call declares a deadline with a strength
carrying the same rule identifier. Presence of the finding is resolved on the goal's rule, because
identifiers are renumbered by every rescan, so the goal read its own rule back out of the finding set,
found it, and reported that the finding still fired. The half of the loop the deadline join opened was
closed again by the reading of its result. A goal is only ever cut from a risk, since a strength is never
goal eligible, so a strength carrying the goal's rule is now read as the evidence that the goal succeeded
rather than that it failed.

### A note beside an argument was counted as one

The parser reports a comment as a named child of an argument list, and a `**` splat was being counted as
a positional argument, so a Python call's keyword object moved along one slot for every note or
passthrough written among its arguments. Everything asking a call what it was configured with reads the
first argument, so it read the note. LangGraph's own command line example writes `add_conditional_edges`
with a comment before each of its three arguments and no handoff was read from it at all; CrewAI's
`Agent(role="Multimodal Analyst", ..., multimodal=True,  # crucial for adding the multimodal tool)` was
named after the variable holding it rather than after the role it declares; and an agent written as
`Agent(name="Assistant", ..., model="litellm/openrouter/openai/gpt-5.4-mini")` with one comment in the
middle had no name, no model and no tool.

A comment is not part of the program and a `**` splat is not positional, so neither takes an argument
slot now. A `*` splat still does, because it genuinely expands into positional arguments and its arity is
unknown, which is what makes every later index unreliable and worth recording. JavaScript already read
the same programs correctly, since an object spread is skipped where it sits and shifts nothing.

Across the pinned repositories this names components the source had named all along and finds relations
that were written down: `openai-agents-python` goes from 620 agents to 617 as nine anonymous ones take
their declared names and merge, from 15 models to 18, and from 34 model invocations to 38; `langgraph`
goes from 175 handoffs to 182; `crewai` from 260 agents to 258 and from 104 containment relations to 106.

### A prompt written in one place and assembled in another

The field report's last item said prompt injection cannot see a prompt built at a raw SDK call site. That is
not so: a template holding the instructions is discovered wherever it is written, including inside
`client.chat.completions.create({ messages: [...] })`. What was not seen is the shape beside it, which is the
common one: the instructions hoisted into a constant and the untrusted value spliced in where the message is
built. Read one literal at a time, the constant interpolates nothing and the template that splices it is twenty
characters long, so it is neither a prompt nor long enough to be recorded at all. The prompt was reported as
taking no run time value while the value went in four lines away, and `prompt-injection-boundary` said no such
prompt had been discovered.

A template now records which names it substitutes, and a prompt is interpolated when its own literal takes a
value or when something splices it together with one. The template has to name something besides the prompt,
since a template naming only the prompt is the same prompt under another name.

Only a name whose whole value is the text counts. The corpus caught two prompts this would otherwise have
marked: a prompt is named for whatever holds it, and `const agent = new Agent({ instructions: '...' })` names
its prompt `agent`, so a template splicing `agent` into a message puts nothing into the instructions. Across
thirteen pinned repositories and two thousand three hundred and seventy nine prompt components, this moves
nothing.

## 0.4.0

Released 2026-08-17 from npm as `orchescope@0.4.0`.

This answers the field report against 0.3.0, from a Swift and AppKit repository with a small JavaScript and
Python surface. Three of the report's items were withdrawn on inspection: the version labelling defect it opens
with was a brief carrying measurements from a different repository, the coverage arithmetic it questions is three
different sets rather than a partition, which is a labelling problem and not a counting one, and the strength rule
it calls structurally unable to fire has been firing on the bundled demonstration system all along.

Its central finding is that two separately filed defects were one, and that the tool built to fix the first one
had never been connected to the second consumer.

### The join reaches a body that does its own work

**A tool that makes its request in place now reaches it.** The join added in 0.3.0 resolves a call through the
binding registry, which answers for a name someone declared and answers nothing for a request written inline. So
a handler delegating to a named function reached the write and fired `side-effect-approval-boundary`, and the
same body with the request inside it reached nothing and the rule reported that no consequential operation had
been discovered, four lines from a POST. Extracting a function was the whole of the difference, and the inline
form is the one the frameworks document. The record of what each call site produced already existed, built for
retry discovery, and never left the adapter that made it; it is on the discovery context now and the join reads
it. In `vercel-ai-chatbot` the weather tool makes one of its two requests each way, and only one of them was
visible.

**A client's own name is not evidence about the operation.** With no enclosing function to read, effect
classification fell back to the callee, `fetch`, which holds no verb, so an inline `POST /v1/transfers` was
`unknown` while the same request inside `sendTransfer` was `non_idempotent_write`. The address answers where no
scope does. The gate that keeps `POST /graphql` out of the write class is unchanged.

**A request with no method stated is the GET its specification defines**, for `fetch` and where the address is
written at the call site. Without it an address would have to answer a question the method already settles, and
`https://host/v1/payments` would read as financial when it is a poll. The method says when it came from the
specification rather than from the call.

### A retry is read for what it states

**A head that can never be false is not a ceiling.** A `for` was bounded if it had any test and a `while` if its
test used a relational operator, so an infinite retry against a payment endpoint was reported as bounded three
different ways: a counter that never advances, a bound that grows every pass, and `for (let attempt = 0; true;
attempt++)`. Both loops now ask one question, whether the head compares a counter against a bound and the body
moves exactly one side of it, and both analysers ask it. A head joined with `and` or `&&` closes when any operand
closes, which is how one pinned repository writes a bounded poll that was being called infinite.

**A wait that grows is recognised in the three ways it is written.** `2 ** attempt`, `Math.pow(2, attempt)` and a
`delayMs` multiplied one statement away from the `sleep` that takes it are one backoff, and only the first was
read.

**A retry is a loop, not a `try`.** Keying discovery off the `try` made it a requirement rather than a form, so a
loop that reads the response and goes round again produced no relation at all. A pass that returns when it
succeeds and falls through when it fails is a re-attempt whatever its counter is called, which is what makes
`for (let i = 0; i < 3; i++)` around a guarded POST visible.

**Sink evidence belongs to the function that showed it.** Read per module, any `maxAttempts` anywhere in a file
became attempt ceiling evidence for every retry in it, so a constant in an unrelated bounded poll suppressed the
finding for an infinite retry twenty four lines away. The rules were declining honestly and about the wrong
function.

**A relation says which operation it repeats.** A function that posts a job and then polls its status builds both
addresses at run time, so both requests are one component named for that function, and asking that component
whether the polled read is safe to repeat answered with the class of the POST.

### A rule says what it looked at

**A key written in code counts as a declared one.** `idempotency: declared` reached the graph only from a hand
written manifest: every adapter that reads source wrote `unknown`, so
`bounded-retry-with-declared-idempotency` could report a strength for a repository that declares a key in
`.orchescope/manifest.yaml` and never for one that carries the key in the request it retries. The schema says
`declared` means a key was found on the retried operation; a key in the arguments of the request being repeated
is that reading, and a key handed to a helper one frame away is not. The field report filed this as a rule
structurally unable to fire, which is a third thing it got wrong: the bundled demonstration system has fired it
from its manifest since before this work.

**Six rules stopped contradicting the document they are printed in.** They said "no run has been recorded" beside
a summary saying one had. A recorded run that produced no span is an attempt to measure and nothing else, and
telling the two apart is the difference between "run your system" and "make your system emit spans". Each now
names what it could not establish rather than only that it could not.

**`prompt-injection-boundary` declines rather than reporting `clear`** over a repository where no prompt
component was built, and `topology-shape` says how much it looked at instead of printing a status word with no
sentence at all.

### The scan says what it did not read

**A directory the configuration excluded is named.** `analysis.exclude` matches a path segment at any depth, and
`build`, `out`, `target`, `vendor` and `coverage` are ordinary module names. A repository with `src/build/` in it
lost every file inside it while the report said `filesSkipped: 0` and listed nothing. The index decides both
ways, as it already does for ignore rules: a directory holding committed source is reported, one holding none is
derived output, and a rule the repository wrote itself is not repeated back at it. `langgraphjs` has a committed
`internal/build` package that was invisible.

**The coverage counts say they are not a partition**, which is what a reader adding them up needs to know.

### Wording a reader can check

- **A relative address has no external host, rather than one this build failed to read.** `fetch("/releases.json")`
  was reported as an unresolved host and explained with "a base address held in a constant is the common cause",
  about an argument that is a fully visible string literal.
- **`isInferencePath` reads the operation a path ends with.** As a fragment anywhere in the address,
  `/v1/messages/batches/msgbatch_1/cancel` and `/v1/fine_tuning/jobs/ft-1/complete` were model invocations.
- **Azure OpenAI and Bedrock are recognised.** They were absent on the argument that their hosts carry a
  customer's name, which is true of the subdomain and not of the `openai.azure.com` suffix or of
  `bedrock-runtime.<region>.amazonaws.com`. They are the two largest enterprise paths to a model, and leaving
  them out described a repository that reaches one as an agent system containing no model.
- **An unknown command names the one the caller nearly typed**, including a nested one, and writes a document
  under `--json` as the help promises every command does. `orchescope validate` answered with the entire top
  level help and no mention of `orchescope goal validate`.
- **A finding names each place once.** Two components minted at the same call each contributed it, and the
  repeats were spent against the ceiling of ten, so places past the tenth entry were dropped for copies of ones
  already shown.
- **The next action says which loop step it stands in front of**, where the two differ. `standingAt` said
  `measure` and its step carried `orchescope trace` while the action said `orchescope init --manifest`, and
  nothing related them.
- **A detection sentence claims only what this reader can claim.** "Nothing looked like an agent, tool, or model"
  is a statement about the repository; what a reader can be told is that none of the adapters here recognised
  one, and the row below names which ones ran.

### The loop reaches its end

**A goal states no criterion its own plan declines to decide.** Two metric criteria were issued whatever the
repository held, while the validation plan in the same document declined to prescribe the `compare` that would
settle them, because no run had been recorded. An operator who did exactly what the goal asked got `not
validated` with two criteria permanently undecided, so a goal that was in fact complete could never say so. They
are issued when there is a baseline, which is when the comparison is prescribed, and the document says what
recording a run would add.

**A validation separates a person from a failure.** "1 of 2 criteria satisfied, 1 undecided" said the same thing
about a criterion that failed, one nothing could judge, and one waiting for a human review to be recorded.

### What will move a reader's numbers

- **`crewai` gains two findings**: an OAuth device code poll that re-sends a POST, and a `while True:` status
  poll with no attempt ceiling. Both were invisible because a retry had to be spelled with a `try`.
- **A repository with a committed directory named `build`, `out`, `target`, `vendor` or `coverage`** now sees it
  named in coverage and in the gap region. Nothing about what is scanned changed; what changed is that the scan
  says what it left out.
- **A retry around a request that carries an idempotency key** becomes a strength rather than passing unremarked.
- **Six rules that reported `insufficient_evidence` still do**, with a different sentence. A reader matching on
  the text `no run has been recorded` will stop matching when a run was recorded and produced no span.

### Known limits, unchanged

Prompt injection reads a prompt that interpolates a value only where that value enters the literal itself. A
prompt assembled from a constant and a substitution somewhere else is recorded as taking no run time value. The
rule now reports `not_applicable` rather than `clear`, so it fails quietly and correctly, and the false negative
is real.

`analysis.exclude` still removes what it matches. This version reports the removal and does not undo it, because
a project that vendors its dependencies on purpose wants exactly that exclusion and only its owner knows which
case they are in.

### Provenance

This version was published from a laptop with `npm publish --no-provenance`, so **it carries no attestation**.
`publishConfig` asks for provenance and the registry generates it from a workflow identity, which a laptop does
not have, so the publish refuses until the flag says plainly that there will be none.

What stands in its place is that the artifact is reproducible. `pnpm package` from this repository builds a
tarball byte identical to the one on the registry, which was checked by downloading the published one and
comparing:

```
sha256  830954e1560432d3c5a68884ad4f3883dfce149d189292de916cdaed9488fd55
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes match
this source; it does not say who published them.

## 0.3.0

Released 2026-08-17 from npm as `orchescope@0.3.0`.

This answers the field report against 0.2.0, from the same TypeScript monorepo the 0.1.0 report came from, roughly
eighteen hundred analysed files.

Its central finding is that three separately filed defects were one defect. An external effect is attributed to the
function that performs it, and nothing joined a declared component to the effect one frame away, so the writes were
present and correctly classified and nothing could reach them. The rules built on that graph were not wrong about their
own logic; they were reading the wrong node, and one of them was structurally unable to fire on any input it had ever
been given.

### The join that was missing

**A tool now reaches what its handler runs.** A tool is declared by a registration call and implemented by the handler
that call is given, and only the first was recorded. Every tool was a leaf, so `side-effect-approval-boundary`, which
asks whether an agent, a tool or an MCP server reaches a consequential operation, answered no every time. It was
suppressing on every input rather than reporting, which is worse than the false positives it replaced, because nothing in
the output distinguishes a rule that checked from a rule that could not.

The declaring adapter now records the source range that implements the component, because only that adapter knows which
argument is the body, and an adapter running after it joins that range to what the calls inside it resolve to. The join is by line
containment: an inline handler is anonymous, so the nearest named scope of a call inside it is whatever encloses the
registration, which at module scope is nothing at all. Five adapters record spans, and any other one inherits the join
by recording a span of its own.

**A retry now names the operation it repeats.** A retry relation ends where its author wrote it, which is usually a
helper rather than the request the helper makes. Discovery mints an entry point for that helper to hold the effect,
nobody classifies a minted entry point, and the guard that refuses to judge an unclassified component therefore refused
every time while the write one hop further was classified all along. The guard is unchanged. What changed is that the
graph can be asked what a component performs, reading through the frames discovery invented and stopping at the
components a repository declared, so a reader is told about the POST that repeats rather than about the function around
it.

**A retry around a request written in place is now visible.** Retry discovery resolved a callee through the binding
registry, which answers for a name someone declared and answers nothing for `fetch(...)` written inline, even though that
request had already been discovered and classified at that exact line.

**A rule outcome carries the size of what it looked at.** `clear` is a claim that something was checked and was fine, and
over an empty population that claim is not weaker than it should be, it is false: one build reported that every
discovered retry had an attempt ceiling in a repository where it had discovered no retry at all, and a build that had
genuinely checked a hundred said the same sentence. Nothing examined is now `not_applicable`, and either way the count
travels.

**`connect` no longer mints a SQLite database.** The name was matched bare, so `server.connect(new
StdioServerTransport())` reported a database in a repository that has none. Across the pinned corpus this was an HTTP/2
session in `axios`, Redis clients in `express` and one chatbot, and MCP transports throughout the OpenAI Agents SDK.
Python's `sqlite3.connect` is still read.

### Retries read what the code states

**A client assigned to a name is still that client.** `const fetchImpl = opts.fetchImpl ?? fetch` is how a module is
written so its network client can be replaced in a test, and every adapter matched on the callee path, so the module
written to be testable was the one that could not be seen. On the reporting repository seven modules were invisible,
including the one whose entire reason for existing separately is that it holds the retry policy: no service, no method,
no retry, nothing. The evidence records the name the source wrote and what it resolves to, because the alias is a fact
about the repository rather than something to normalise away.

**A `while` head that compares a counter against a bound states a ceiling.** Every `while` was read as unbounded, which
told the author of `while (attempt < maxAttempts)` that no attempt limit could be established from their source. A
condition testing a flag still states none, because a flag says nothing about how many passes there are.

**The wait between attempts is recorded rather than only required.** A discovered retry now declares whether it waits the
same amount each pass, waits longer, or does not wait at all. Exponential is claimed only where the syntax exponentiates.
The last of the three is the dangerous one, since it re-attempts as fast as its dependency can fail, and it used to be
reported as `unknown`, which reads as a gap in the reading rather than as a fact about the code.

### The contract a traced command exposes

Three changes that a pipeline reads, and the reason this command was hard to adopt in continuous integration.

**A traced command exits with the status it exited with.** Every failing status became a single 4, so a step could tell
that the target had failed and not how, and a suite that distinguishes its failure modes by exit code lost that
distinction by being measured. This is what `timeout`, `env` and `nice` do.

**The run report moved to standard error**, beside the privileges notice, because the report is a diagnostic and the
traced program's output is the payload. On standard output it interleaved with the target's own bytes, so
`orchescope trace -- generate > out.json` wrote a file with a run summary in the middle of it.

**`--json` no longer discards the target's output.** It was dropped entirely rather than relocated, so an agent that
traced a build to read its output got a document about the run and none of what the run said. Standard output carries the
document and the target's own output moves to standard error.

### Detection and wording

- **A host written before the first substitution is read.** `` `https://api.stripe.com/v1/charges/${id}` `` says which
  service it reaches, and reading only plain strings made every such request a component named for the function that
  built it. The authority has to be complete before the substitution: `` `https://api.${region}.example.com/x` `` states
  no host, and reading one out of `https://api.` would be a confident answer to a question the source did not settle. The
  address recorded this way is marked as a prefix rather than reported as the request.
- **The adapter says how many addresses it could not resolve.** A base address held in a constant is the common cause and
  following one is not something this build does, so the count and the reason are reported rather than left to be
  inferred from a list of components named after functions.
- **A rule agrees with its own count.** `3 consequential operations was left unreported` and `2 runs was recorded` both
  reached readers. A tool that reasons about grammar less carefully than it reasons about evidence invites a reader to
  weigh the rest of its output the same way.
- **A model reached by a plain request is told to set a deadline, not to configure a client.** There is no client at that
  call site, so the goal cut from that finding asked an agent to change something absent from the only scope it was
  allowed to touch.
- **The MCP audit payload names the build that produced it.** A server is started once and serves every call in a
  session, so an upgrade installed while it runs changes nothing a caller can see, and an agent comparing today's audit
  against a finding it recorded last week could not tell a change in the repository from a change in the reader.

### The repository decides what is part of it

**Traversal reads `.gitignore`.** The fixed list of directory names it used instead is a guess at what those
files say, and it loses to every project that puts its build output somewhere else. Nested ignore files,
negations and anchored patterns are all read, and every file excluded this way is named in coverage with the
rule that excluded it, so a reader who disagrees can see exactly what happened.

**A file the repository tracks is kept whatever the rules say.** An ignore rule states an intention and the
index states the outcome, and git honours the index. One pinned repository ignores `*_*.md` and has
committed twenty one documentation files matching it, so a build that read the rules and stopped there would
have deleted real source from its own view of that repository. Reading the rules without reading the index
is the version of this feature that removes what it was meant to preserve.

The effect is nothing at all across the pinned corpus, where the rules and the index agree everywhere. It
shows up on a working checkout: on the reporting repository it sets aside sixteen files, among them
`.DS_Store`, a `.env`, a `.dev.vars`, three generated `worker-configuration.d.ts` and a deprovisioned
deployment manifest.

**A provider host is asked what the request is for, not only which host it is.** `POST
https://api.openai.com/v1/realtime/client_secrets` mints an ephemeral token, and recognising it by host
alone reported it as a model invocation and then cut a goal telling an agent to put a request timeout on an
authentication call. The test is stated as the operations that run a model rather than as the endpoints that
do not, because a list of exclusions loses to whatever a provider ships next, and it lives in the table both
sides of the join already share, so a run and a call site describing the same request cannot disagree about
what it is. The request stays in the graph as a request: dropping a discovered outbound call would trade a
wrong answer for a missing one.

### Upgrading

**A traced command's exit code is now the target's.** If you gate on `orchescope trace` exiting 4, that gate no longer
fires; read the status the target actually returned, or read `data.exitCode` from `--json`, which names the target's
status and nothing else. Orchescope's own codes still apply on every path that ends before a target runs.

**Anything parsing the run report from standard output has to read standard error instead.** Standard output now carries
the traced program's output, or the JSON document, and nothing else.

**A repository with untracked build output will report fewer components.** Traversal now reads the
repository's ignore files, so anything excluded there and not tracked is no longer analysed. Coverage names
every such file and the rule that excluded it.

**Finding counts will move, in both directions.** `side-effect-approval-boundary` can now reach operations behind a tool
handler and will report them where it previously reported nothing. Retry findings name the operation rather than the
enclosing function, and retries around an injected client or an inline request appear for the first time. Against the
reporting repository the retry count rose by one and seven previously invisible modules entered the graph. A `while` loop
that states its own ceiling is no longer reported as unbounded.

**No schema changed.** The candidate counts travel in a rule's detail, the unresolved address count in the adapter's
existing note, and the version on the MCP payload is an additive field rather than a persisted document. Configuration
stays at `schemaVersion` 3.

### Known limits, stated rather than left to be discovered

- **A retry that neither waits nor counts is still invisible.** Making the wait optional rather than required would need
  a new evidence form for an infinite loop around a `try`, and on the reporting repository all sixteen such loops are
  streaming, paging or scanning, several inside a `try` and several returning from the body. Claiming that shape would
  report a file tailer as an unsafe retry.
- **An address assembled from a constant is still unresolved.** Reading `${API_BASE}${path}` needs constant propagation,
  which is a feature rather than a patch. On the reporting repository this is a hundred and four call sites, and the
  coverage block now says so.

### Provenance

This version was published from a laptop with `npm publish --no-provenance`, so **it carries no attestation**.
`publishConfig` asks for provenance and the registry generates it from a workflow identity, which a laptop does
not have, so the publish refuses until the flag says plainly that there will be none.

What stands in its place is that the artifact is reproducible. `pnpm package` from this repository builds a
tarball byte identical to the one on the registry, which was checked by downloading the published one and
comparing:

```
sha256  ded9076b1f50a884410a20c4dd6742f802e09c95083a51eb4d6d5177de278058
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes match
this source; it does not say who published them.

### Verification

`pnpm verify` green at 834 unit and 107 end to end tests, from 782 and 103. `pnpm corpus` matches across thirteen pinned
repositories, with every expectation that moved read against the cited source: the removed databases are an HTTP/2
session, two Redis clients and a set of MCP transports; the added services are `axios` reaching its own fetch adapter
through `let _fetch = envFetch || fetch`, two injectable clients in the LangGraph SDK, and three hosts recovered from
template literals. Each fix carries a test that fails without it.

## 0.2.0

Released 2026-08-16 from npm as `orchescope@0.2.0`.

This release answers a field report from two sessions against real systems: one deep run through the full loop against a
private TypeScript monorepo, one sweep of `audit --json` across thirty six repositories. Its finding was that the tool
systematically treated *absence of measurement* as *measurement of absence*, and that its pattern matching rules were
being fed generated code. Across those thirty six repositories the retry rules produced no true positive at all, and both
findings marked goal eligible in the deep run were false.

Almost everything below exists because of that report.

### A traced run now produces evidence

Before this release, `orchescope trace` set three OpenTelemetry environment variables and nothing else. They are inert
unless the target process already loads an OpenTelemetry SDK, and essentially no Node project does, so every traced run
in the field report collected zero spans and every audit stayed inventory.

Orchescope now loads its own instrumentation into a traced Node process through `NODE_OPTIONS=--import`. It records
outbound requests and names each one by what it did: a call to a published model endpoint becomes a model call with the
provider, the model and the token counts; a JSON-RPC document becomes a protocol call naming the tool it executed,
including a tool call a target makes to a server it started over standard input; anything else is a request to a service.

The shim is deliberately small and deliberately inert. It refuses any endpoint that is not loopback, stands down
entirely if the target already runs OpenTelemetry, registers no signal handler, never writes to the target's output, and
swallows its own failures. It also reports what it declined to patch, so a run that collected nothing can say why rather
than looking like a target that made no calls.

**This puts Orchescope code inside a process you own.** It is on by default because that is the difference between what
the product claims and what it delivers, and it is a setting, `runtime.autoInstrument`, because you may not want it.

### Findings that were confidently wrong

**Nothing derived from a run that measured nothing.** A recorded run is evidence that a command executed, not that
anything was observed. Runs are now split into those that produced at least one span and those that produced none, and
the vocabulary lives in the domain layer so every rule inherits it rather than remembering it. An empty run no longer
reaches reconciliation, no claim can carry `basis: observed` with nothing observed, and an acceptance criterion facing
absent data reports `undecided` instead of banking a zero it never earned.

**A loop is a retry only when something in it says so.** A loop containing a `try` and an `await` is also the shape of
per item iteration with per item error isolation, and of a one shot helper whose only `try` guards a parse. A re-attempt
now has to be stated by the code: a wait before the next pass, or a header that counts attempts.

**A rule does not assert an absence it never checked.** Before reporting a missing idempotency key or attempt ceiling,
discovery follows the call one frame into the sink and looks for a deduplicating statement, a key derivation or a
declared bound. What it saw is recorded and the rules decline rather than accuse, and they say how many they left alone.

**Generated code is set aside by what it is, not where it lives.** A name based exclusion list will always lose the race
against `.docs-out`, `packages/extension/media/assets` and whatever the next bundler writes. Detection is by content, and
its thresholds were measured against this repository's own source, its pinned corpus and six published minified bundles.

**A consequential operation is a finding only where a model can reach it.** The risk this rule names is a model deciding
on its own to invoke something consequential. Firing on every consequential operation instead raised four React
components issuing `DELETE` behind a user's click, a continuous integration script posting to GitHub, and a sandbox event
sink. Operations it declines are counted and named rather than dropped silently.

### Detection accuracy

- **A coding agent's configuration is not your system.** A `.mcp.json` listing one server was enough to report a two
  hundred and twenty component Cloudflare Workers application as a detected agent system holding no agent, no tool and no
  model, and then to raise a finding against that repository because nothing in it could reach the server. Servers are
  now recorded as implemented, consumed, or developer tooling, and the last of those is neither evidence of an agent
  system nor part of its topology. It still appears in the graph, because it is a true fact about the repository.
- **A model call is recognised by the host it is sent to.** A system that calls a provider through `fetch` rather than
  through its published package has no import to find, and one project in the sweep ran thirteen MCP servers and reached
  OpenAI by posting to `api.openai.com` with no `openai` entry in its manifest. The audit described a fifty seven
  component agent system containing no model. The host table is now shared between static discovery and the runtime shim,
  so a repository is recognised the same way whether the evidence comes from its source or from its traffic.
- **A host the source never writes down is named for its call site.** Every request whose address is built at run time
  used to be one component called `unresolved-host`: in one project, eleven call sites across nine files in three
  packages, merged into a single node carrying one effect class that could be right for at most one of them.
- **An adapter that read nothing says so.** The `adapter_blind_spot` kind is now `adapter_found_nothing`, because the
  reason beside it has always named two causes and declined to choose between them. The old name is still accepted for
  reading and is never written.

### The agent surface

- **`create_improvement_goal` returns the goal a finding already has.** Six calls with the same finding identifier
  produced six identical goals, which an agent exploring the response shape does without meaning to. The match is on the
  rule as well as the identifier, since a finding identifier is renumbered whenever the set of findings changes. Pass
  `createAnother` to cut a second goal deliberately.
- **Every answer now arrives in the text block as well as the structured payload.** `get_findings` used to return
  `2 of 2 findings.` and nothing else as its text content, so a client that renders text showed its reader nothing and a
  model that did not know to look reported that it had found two findings and nothing about them. The text mirrors the
  same bounded page, one line per record.

### Workspace and honesty about scope

- **State is excluded from git from the first run of any command.** The nested `.gitignore` used to be written only by
  `init`, and the quickstart tells you to run `audit` first. Across the sweep that left thirty of thirty three git
  repositories showing an untracked `.orchescope`, ninety seven megabytes in total.
- **`init` says when a rule in your repository will bury the configuration.** It prints that
  `.orchescope/config.json` is meant to be committed, and git does not consult a `.gitignore` inside a directory an
  ancestor rule already excluded. The fix it prints was measured against git rather than reasoned about, because the one
  that first suggests itself does not work: git will not re-include a file whose parent directory is excluded. `doctor`
  reports the same thing.
- **The command allow list is described as the guardrail it is.** It checks `argv[0]` only, so `orchescope trace --
  seorak` is refused while `orchescope trace -- npx seorak` runs, and `npm run`, `uv run` and `node -e` walk past it the
  same way. Checking further would close nothing, because a runner's argument is any command.
- **A traced command runs with your full ambient privileges.** It writes the files it always writes, binds the ports it
  always binds and reaches the network it always reaches. Orchescope adds environment variables and, for a Node target,
  loads its own instrumentation. It takes nothing away and it is not a sandbox. This is now said in the documentation and
  once in the terminal as the process starts.

### Upgrading

**Configuration moves to `schemaVersion` 3.** `allowProcessSpawn` and `allowedCommands` are now `execution.allowProcessSpawn`
and `execution.allowedCommands`. They decide whether Orchescope starts a process and which one, and they used to sit
beside the settings that constrain Orchescope itself, where a reader taking the block as a whole concluded that tracing
was sandboxed.

A file written before the split is read forward and `doctor` reports that it was, so nothing breaks on upgrade. A file
naming the same setting in **both** places is refused rather than resolved: picking a winner would discard one of the two
values you wrote, and the direction that gets discarded is the one that denies something.

**Two severity changes will move your finding counts.**

- `observability-coverage` on a repository with no run recorded drops from medium to info. It fired in twenty three of
  twenty three repositories that had a component, which is a finding carrying no information: it says you have not run
  the next step yet, and the loop already says that and routes to it. A run that was recorded and produced no spans stays
  at medium, because something was attempted and the instrumentation did not land. If you gate continuous integration on
  `audit --fail-on medium`, a repository nobody has traced will now pass where it used to fail.
- `side-effect-approval-boundary` fires only where an agent, a tool or an MCP server reaches the operation.

**Component counts will move.** A request whose address is built at run time is now one component per call site rather
than one per repository, and a call to a known model provider becomes a model and a provider rather than an anonymous
external service.

### Provenance

This version was published from a laptop with `npm publish --no-provenance`, so **it carries no attestation**.

What stands in its place is that the artifact is reproducible. `pnpm package` from this repository builds a tarball
byte identical to the one on the registry, which was checked by downloading the published one and comparing:

```
sha256  a65b91582690dd470942b95c4c2fdf124609d1007d72507ac9ea4f7f4da30b64
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes match this
source; it does not say who published them.

### Verification

`pnpm verify` green at 782 unit and 103 end to end tests. `pnpm corpus` matched across thirteen pinned repositories, with
every expectation that moved traced to a call site read by hand. The published artifact was installed from the registry
into a clean prefix and audited a real TypeScript and Python project, which is the check that matters, because the
parsers resolve a native binding and a WebAssembly grammar relative to their own package directories.

## 0.1.0

First published release.
