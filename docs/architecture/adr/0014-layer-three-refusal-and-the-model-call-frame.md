# ADR 0014: A refusal is bounded by display, not by vocabulary, and a model call site is a frame rather than an agent

- Status: accepted
- Date: 2026-08-25
- Deciders: repository maintainers

## Context

The [0.9.2 acceptance check](../../research/0.9.2-acceptance-used-holdouts.md) measured the published
release against eight repositories, three of them run. It recorded fifteen silent false negatives and four
false positives, and met three of six release-block criteria. Every defect it found lives in framework-blind
code.

The [layer model design](../../research/0.9.3-framework-blind-layer-model.md) states the invariant those
defects break: layers 1 to 3 are sufficient for correctness and layer 4 adds resolution only. Holding it
needs four decisions this record fixes, because each of them is reader-visible and each has a defensible
alternative.

Two measurements set the frame.

**The conjunction is layer 4's standard applied to a layer 3 artefact.** `hasToolsAndModelKeys` requires a
tools-shaped key and a model-shaped key before an unread construction is reported. That predicate exists
because [ADR 0004](0004-provenance-not-confidence.md) refused widening recognition, and it was applied to a
producer that recognises nothing. An `UnsupportedArea` has no identity, enters no population, moves no
metric and cannot flip `agentSystemDetected`. The file's own header already draws the line: adapter silence
is "a claim about this build", not a claim about the repository.

**A function that calls a model already produces two components.** Measured on a two-import fixture whose
single function performs a chat completion and one outbound write:

```
agent              agent:handlerequest        tags=['hand-written-loop']              inferredFrom=model call site
entrypoint         entrypoint:handlerequest   tags=['entrypoint','inferred-entry-point'] inferredFrom=enclosing scope of an external effect
```

One function, one file, one enclosing scope, two components. `identityKey` includes the kind
(`packages/domain/src/identity.ts:73-74`), so the two never merge. The graph reports two things where the
repository has one, and one of them additionally carries a claim the source does not support.

## Falsifier stated before implementation

Reject this record unless all of these hold after the change.

1. A construction whose root symbol resolves to a distribution no adapter claims, and one of whose
   argument names carries a model, tool or prompt stem, produces at least one line in the human document.
   **This was stated before implementation as "whatever its argument shape, including when it has no
   arguments at all", and that stronger form was measured twice and refused. See "What the measurement
   refused". The falsifier is recorded as it was written and as it was weakened, because a criterion
   quietly relaxed to match an outcome is worth nothing.**
2. `open-agent-platform` still reports `agentSystemDetected: false` with 26 components and no `agent`,
   `model`, `tool` or `mcp_server` key in `components.byKind`.
3. `orchescope-discovery` still holds its ceiling of zero components.
4. The negative control of the 0.9.2 acceptance set still produces no agent and no invented component.
5. The fixture above produces exactly one component for `handleRequest`, carrying both the `invokes_model`
   edge and the effect scope.
6. No component the product invents from a bare model call is counted in an exercise rate that its own
   runtime half cannot observe.

## Decision

### 1. A layer 3 refusal is bounded by display and sampling, never by a vocabulary gate

ADR 0004 governs producers that emit a `Component`. It does not govern producers that emit an
`UnsupportedArea`, and applying it there is what made silence the default. A refusal is widened freely on
provenance and bounded afterwards, in two tiers.

**Tier A, located.** A site whose argument shape carries a model-shaped, tool-shaped or prompt-shaped
segment, matched against key *segments* rather than against whole key names, so `modelPath`, `model_client`
and `systemPrompt` are one stem written three ways and none of them is listed. Sampled per distribution, so
one noisy directory cannot evict a pinned construction.

**A second tier under it, with no argument predicate, was proposed here and is not shipped.** The argument
for it stands and is worth reading: argument shape is a property a construction may not have, so
`create_agent(config)` and `build_agent()` are silent under every predicate over arguments, and only a
floor that asks nothing about arguments makes silence impossible rather than unlikely. It was implemented
in both a broad and a narrow form and measured over the whole corpus, and both forms cost more than the
silence they removed. "What the measurement refused" records what each one produced.

**A distribution is foreign by provenance, not by name.** Not relative, absolute or `node:` prefixed; not a
Node builtin or a Python standard-library module, taken from the runtime's own list rather than one this
repository maintains; not behind a path alias the repository declares; not a module path the repository
defines; not claimed by an adapter. Re-exports are followed: a local specifier is resolved to the module it
names and that module's imports are asked where the symbol came from, because wrapping a third-party
library in an internal module is the most common production shape there is.

**Declaredness in a dependency manifest ranks and never gates.** `readManifests` is root-only, so gating on
it drops real distributions in monorepos and optional extras, which manufactures exactly the silence this
record removes.

### 2. The display layer is part of the guarantee

The invariant is a claim about what a reader is told, not about what the graph contains. There are three
ceilings in series between a construction and a reader: the discovery sample, the per-distribution sample,
and `ROW_CEILING = 4` in the terminal, where unsupported rows rank fourth of six.

`area` carries the identifying content, because `unsupportedRows`
(`apps/cli/src/terminal/gap-rows.ts:115-124`) renders `area.area` and nothing else, by stated policy.
`reason` carries the paragraph and every count, because the corpus observation records `area` and a count
in that string makes the largest entries churn on unrelated edits.

The third ceiling is **not** closed. `ROW_CEILING` still collapses the overflow to a count of kinds rather
than naming them, so a located refusal that survives the discovery sample and the per-distribution sample
can still be replaced by `N more kinds of gap, in the report` when a repository already has a failed
adapter, a truncated scan and a skipped file. Naming the dropped kinds in that row is the remedy and it is
not written.

### 3. A model call site is an inferred entry point, not an agent

The four sites that mint `kind: 'agent'` for the function enclosing a model call
(`vercel-ai-sdk.ts:248`, `model-sdk.ts:937`, `:1022`, `:1156`, and `promptConsumerForModelCall` at
`model-sdk.ts:1076`) mint an inferred entry point instead, carrying `INFERRED_ENTRY_POINT_TAG` and a second
tag distinguishing a model frame from an effect frame.

**No new component kind is added.** `ensureScope` (`packages/discovery/src/adapters/effects.ts:412-440`)
already mints this exact shape as an inferred entry point and already draws `invokes_model` from it. Adding
`model_caller` would put a second vocabulary on one concept, which is the failure
`packages/discovery/src/call-relation.ts` and `packages/domain/src/inferred-entry-point.ts` each warn
against in their own headers, and it would preserve the measured duplication under a new name instead of
collapsing it. Reuse merges the two components into one by `identityKey`, which is the correct graph.

This is a reuse argued and recorded, not a silent one. The alternative was weighed on its evidence and
refused on three grounds: it duplicates a concept the graph already names, it adds a member to eight
kind-keyed sets that carry no compile-time safety and of which two are already stale, and it moves the
document version for a distinction the tag already draws.

**The frame keeps every fact.** The `invokes_model` edge, the declared deadline it carries, the prompt
attribution, the provider qualification and the nested-binding identity all move with it unchanged.
`details.for` must equal `kind` or `componentViolations` (`packages/domain/src/invariants.ts:22-24`) reports
a violation, so `details` is rewritten rather than carried, and `toolCount` and `maxTurns` move to metadata
and to the relation policy where the adapter already writes the latter.

**The frame is not observable.** It stays out of `OBSERVABLE_KINDS`. Auto-instrumentation observes HTTP
requests, never function names, so a source-only enclosing-function identity can never appear in a span. A
kind in that set that no run can name reports `declared-not-exercised` on every run forever, which is
exactly what the acceptance check recorded. The honest cost is stated rather than hidden: the frame can
also never be reported as exercised.

**The tool-using branch stays an agent.** `isToolLoop` at `vercel-ai-sdk.ts:245` has structural evidence of
a loop over a tool population. A bare generation call does not.

### 4. The refusal vocabulary is reused for a located site and extended once for an aggregate

`unclaimed_imported_construction` keeps its name and its published position in `system-graph.v1.json`,
`report.v1.json` and `federation.v1.json`, and its definition is rewritten to be provenance-shaped, because
a class definition has no arguments and the current wording names the conjunction. One kind is added for
the tier B aggregate, because an unlocated claim about a distribution is a different claim from a located
one about a site: the corpus acceptance requires a located area, and the terminal ranks the two
differently. That is the whole of the schema change, and it touches no component identity and no
population.

## What the measurement refused

**Tier B, as a floor under every construction, was implemented and measured and is not shipped.** The
strict reading of the invariant is that a construction from a distribution with no adapter must be
incapable of producing nothing, which means naming every foreign distribution a repository constructs
from, with no argument test at all. Over the corpus that names `react` three hundred and sixty two times
on one application, forty eight distributions on a second, twenty one on the pinned entry
[ADR 0004](0004-provenance-not-confidence.md) turns on, and it puts a refusal on the acceptance negative
control that passed cleanly. It is true and it is worthless, and it would flip `scanPopulationComplete`
on nearly every entry.

**The narrower version, over base classes and decorators only, was also implemented and measured and is
also not shipped.** The argument for it was that a declaration with no arguments is a different case from
a construction whose arguments named nothing: there the test applied and answered, here it does not
apply. A fourteen repository sample supported it, showing five distributions on the LlamaIndex target,
three on `flask` and nothing anywhere else. The full corpus refuted it: twenty four of forty eight entries
moved, and the content is `pydantic.X(BaseModel)` on a dozen entries, `click` command decorators,
`pyqt6.X(QWidget)`, `discord`, `streamlit`, `@angular/core.@Component` and `typing_extensions.X(TypedDict)`.
On three entries the data models evicted the real construction out of the bounded sample entirely.

The reason is worth stating because it will be proposed again. A base class and a decorator are how
**every** Python library asks for a declaration, not how agent frameworks do. Data models, command line
interfaces, GUI widgets and web frameworks all use the same two forms, and nothing structural separates
`class AgentWorkflow(Workflow)` from `class Invoice(BaseModel)`. Separating them needs a vocabulary of
framework names, which is the thing being removed.

**So the invariant is held in a weaker form than its literal statement, and the gap is stated rather than
papered over.** A construction whose arguments name a model, a tool or a prompt cannot go silent. A
construction with no arguments at all, `create_agent(config)` or `build_agent()`, still can, and so can a
framework whose only declaration form is subclassing. `class AgentWorkflow(Workflow)` in the 0.9.2
acceptance set is not named by this build, and the two measurements above are why.

## Consequences

**Findings move on up to forty-one entries.** `scanPopulationComplete`
(`packages/graph/src/analysis.ts:340-346`) requires every unsupported area to be `topology_incomplete` with
scope `prompt_use`. The first refusal on a repository flips it, which flips `acyclicityComplete`,
`reachabilityComplete` and `narrownessComplete`, stops `unreachableDrafts` running and withholds the
topology strength. Forty-one of forty-nine corpus expectations currently record none of the four unsupported
populations, which bounds it. The corpus already absorbs this for the two entries carrying a refusal today,
so the mechanism is measured rather than predicted.

**A repository whose only agents were frames stops reporting agents.** That is the correction, not a
regression, and it is visible as reduced positive output: the topology strength requires an `agent`,
`agent_group` or `workflow` in the audited set. Two rules that hard-filter `kind === 'agent'`,
`wideFanOutDrafts` and `repeatedContextRule`, stop firing on frames; the frame is added to
`MODEL_DRIVEN_KINDS` seeding so `side-effect-approval-boundary` does not lose coverage, which would
otherwise be a security-rule regression.

**Component identities change once.** `isRenameOf` requires an unchanged kind
(`packages/domain/src/identity.ts:89-92`), so `compare_runs` reads the reclassification as delete plus add.
A `ComponentAlias` with reason `renamed` records it rather than leaving a reader to infer churn.

**Two defects of this shape are named and not fixed here.** MCP recognition gates its SDK call sites on a
three-entry distribution allowlist (`packages/discovery/src/adapters/mcp.ts:38`), which is structurally the
same object as the twelve-entry host allowlist this work removes, so layer 1 is half framework-blind.
`LANGUAGE_MARKERS` (`packages/discovery/src/discover.ts:116-125`) is an eight-entry list, so a repository
written in a ninth language is silent before any layer runs. Both are recorded so the next person finds them
written down rather than by measurement.

## What would reverse this

**A construction from an unclaimed distribution that produces no line in the human document.** That is the
guarantee, and one counterexample ends it.

**A structural signal that separates an agent declaration from a data model declaration.** The floor was
refused because no such signal was found: a base class and a decorator are how every Python library asks
for a declaration, and `class AgentWorkflow(Workflow)` is not distinguishable from `class Invoice(BaseModel)`
without naming frameworks. A signal that does separate them, measured over the whole corpus rather than a
sample, reopens the floor and with it the literal form of the invariant.

**`open-agent-platform` gaining a component, or `orchescope-discovery` leaving its ceiling of zero.** Those
are the pinned canaries. If widening a refusal moves either, the premise that a refusal is categorically
different from a recognition is wrong and the argument has to be made again.

**The frame entering `OBSERVABLE_KINDS`.** That is the defect the acceptance check recorded, returning under
a name that reads as a fix.
