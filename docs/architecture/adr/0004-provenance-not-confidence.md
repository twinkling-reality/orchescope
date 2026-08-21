# ADR 0004: Recognition is widened by provenance, never by lowering a confidence band

- Status: proposed
- Date: 2026-08-20
- Deciders: repository maintainers

## Context

The standing proposal for scaling the declared half is a convention driven reader: recognise what
generalises, an import of a known distribution, a call whose object argument carries known keys, a
recognisable configuration shape, an entry point reaching a model, and report it with an explicit
confidence band. Keep per framework readers only to raise confidence or to read what conventions cannot.

`docs/guides/adapter-development.md` already tells an author to use `CONFIDENCE_BANDS` rather than invent
a number, "because a reader compares two findings on the assumption that the numbers mean the same thing".
The proposal reads as a natural extension of that.

It was tested rather than argued. The two stated recognizers were implemented against this repository's
own `analyzeFileSet` and its own vocabulary tables and run over the pinned negatives.

**On `open-agent-platform` the import recognizer fires 40 times and the known keys recognizer fires
twice.** That entry is pinned `not_agent_system` with a ceiling of 26 components, and its own committed
prose states the prediction: "a reader widened until an import or an SDK type is enough moves that zero
and this entry with it." It is a client of agent systems rather than one of them. It imports
`@langchain/langgraph-sdk`, `@langchain/core` and `@modelcontextprotocol/sdk`, and declares no graph,
because the graphs it talks to are somewhere else. The two known keys hits are
`createAgent({name, description, config})` in a dialog configuring a remote deployment. Either recognizer
produces a component of an agent system kind, which flips `agentSystemDetected` and cascades through the
gate at `prompts.ts:192` to a measured 26 components becoming 34.

The band cannot stop it, and the reason is three call sites:

```
sed -n '443,449p' packages/discovery/src/discover.ts   # agentSystemDetected: kind and audited population, no threshold
grep -n "confidence" packages/graph/src/reconcile.ts   # two hits, both the literal 0.95 written onto an output
grep -n "mergeConfidence" packages/graph/src/merge.ts  # Math.max
```

`MIN_CONFIDENCE_BY_SEVERITY` at `packages/domain/src/severity.ts:42` does cap a finding's severity by its
confidence, so a band is not inert everywhere. It is inert in the two places that decide what a component
is and whether a repository is an agent system, and `mergeConfidence` is `Math.max`, so a weak component
merged with a strong one takes the strong number.

Walked against the four recorded confident wrong answers, the band changes none of them:

- **The `.mcp.json` Cloudflare Workers failure.** A reader keyed on the `mcpServers` key was *correct*
  about the server. The wrong claim was that the repository is an agent system. What fixed it is
  `mcp.ts:115` writing `role: 'developer_tooling'` and `audited-system.ts:28-30` excluding that role from
  the audited population. That is a provenance field, and a path to owner table is data.
- **The express app with an `agents.yaml`.** `packages/discovery/test/adapters.test.ts:537-563` writes
  exactly that repository, and the document passes `declaresAnAgent` at `crewai.ts:96-104` completely. The
  shape gate does not catch it. What catches it is `crewai.ts:122-129`, which reads a document found by
  name only where the repository declares the framework whose layout puts it there.
- **The VCR cassette matched by `endsWith('agents.yaml')`.** A string matching defect, equally available
  to either design. It gets worse under a band, because the whole function of a band is to make emitting
  when unsure the default instead of declining, and nothing downstream reads the number.
- **Two declarations sharing a role merged into one component.** The fix needed a pass counting role claims
  across the whole document before naming anything, and it needed the knowledge that a `runtimeName` is not
  a name but a claim about a run. A low band on a wrong `runtimeName` is still a wrong `runtimeName` in the
  reconciler's strongest lookup after a code location, waiting to match something else.

Every one of those four was an identity or a provenance error. None is in the range a scalar can express.

The constructive half of the measurement is that the gates which did work are all conventions, and all
expressible as data:

| gate | where | what it is |
| --- | --- | --- |
| a document found by name needs the framework declared | `crewai.ts:122-129`, `:362` | convention |
| a document opened for one kind is not another's to read | `mcp.ts:151-152`, `config-files.ts:31` | convention over `ConfigOrigin` |
| a config path belongs to the developer, not the repository | `config-files.ts:90-98`, `mcp.ts:115`, `audited-system.ts:28-30` | path to owner table |
| name matching is by basename, not by suffix | `config-files.ts:230`, `crewai.ts:108` | convention |
| a declaration only a test makes is not the system | `effects.ts:1548`, `audited-system.ts:28` | convention |
| entries must carry a role and a goal | `crewai.ts:96-104` | framework vocabulary as data, and insufficient alone |

The load bearing mechanism in five of those six is `ConfigOrigin`, which records *why* a document was
opened. Precision here has never come from a number. It has come from knowing where a thing came from and
who it belongs to.

## Decision

**Recognition is widened by provenance and never by lowering a confidence band.**

Concretely:

1. A proposal to recognise more must name the provenance that keeps it precise: the dependency that must
   be declared, the origin the document was opened under, the owner the path belongs to, or the population
   the component is excluded from. A proposal whose only safety mechanism is a lower confidence value is
   refused.
2. Confidence remains what it measurably is: an input to severity, and nothing else. It is not read to
   decide identity, detection, or a reconciliation match, and adding such a read is a separate decision
   with its own record.
3. The six gates above are lifted into one shared precision layer, expressed as data, that every producer
   passes through. That is where every measured wrong answer was stopped, and centralising it is what makes
   a fourteenth reader safe rather than merely cheap.
4. Recognition itself stays per framework. The eight blocks a convention cannot express are 380 lines in
   `adapters/` plus `graph-node-route.ts`, 8.5% of the code, and they produce roughly 12% of components and
   about 15% of the merged graph's relations, which is most of its topology. A convention reader that emits
   one component per matched call gets the nodes and loses the edges.

`docs/guides/adapter-development.md` is amended so that the confidence section says what a band is for and
what it is not for, rather than implying it carries precision.

## Consequences

**A widening proposal has a shape it must take.** "Emit it at `heuristic`" is not a weaker claim than
"emit it". It is the same claim with a decoration, and this record is what to point at.

**The precision layer becomes the thing worth investing in.** It is data, it is shared, and it covers adapters
that do not exist yet. The dependency property in [ADR 0005](0005-corpus-invariants.md) is its machine checked
half.

**One documented claim is corrected rather than kept.** The adapter guide's confidence advice reads as
though a band travels with a component into every decision. It does not, and an author following it
believes their component is being held to a standard nothing applies.

## What would reverse this

**`open-agent-platform` reading `agentSystemDetected: false` with a convention reader enabled**, with
`components.total` still 26 and no `agent`, `model`, `tool` or `mcp_server` key in `components.byKind`.
That is the measurement that was run and failed; passing it would mean a convention reader can carry its
own precision after all, and this record should be reopened rather than worked around.

**Or a build in which confidence is read where identity is decided.** If `agentSystemDetected`,
`resolveObserved` and `mergeConfidence` come to read the band, the premise here is gone and the argument
has to be made again on the new call sites. Note that such a change is itself a decision that needs
recording: raising a threshold silently would suppress components no reader asked to lose.
