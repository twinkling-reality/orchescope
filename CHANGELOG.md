# Changelog

Notable changes per released version. Nothing here is generated; a release is a person writing down what moved and why.

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
