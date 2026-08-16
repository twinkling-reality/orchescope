# ADR 0002: Analysis is deterministic

- Status: accepted
- Date: 2026-07-25
- Deciders: repository maintainers

## Context

Every part of a model based analysis path existed except the part that calls a model. The configuration block, the
policy gate, the doctor check, the report capability, the `model_interpreted` basis with its severity cap, the
`model_judge` scenario evaluator and an evidence builder for model interpretations were all present and wired.
`modelInterpretationEvidence` had no caller outside its own test. The optional workflow that was supposed to exercise
the path filtered an array of findings for `basis === 'model_interpreted'`, found none, and passed.

So the product shipped a gate that opened onto nothing, a setting a user could turn on that changed no behaviour, and
documentation across the README, the non goals, the permission model, the threat model, the data handling note and two
protocol documents describing a feature that was not there. That is the first failure mode this repository keeps
finding in itself: documentation describing behaviour the code does not have.

Phase 17 required this to be decided rather than left: implement it as proposals and never as facts, or remove the
dead interface and state that analysis is deterministic.

The corpus is what made the decision answerable. Fourteen pinned repositories, ten of them agent systems across six
frameworks and two languages:

1. **No corpus repository contains a language no parser here reads.** `languagesNotAnalysed` is empty in all fourteen
   expectations. The stated purpose of the model path was to read the facts of a file no adapter could read; there is
   no such file in the corpus.
2. **Every gap the corpus does report is an adapter form in a language already parsed.** Four adapters found nothing across three
   repositories: `langgraphjs` imports the Vercel AI SDK and an OpenAI client that the adapters claiming them read
   nothing from, and `crewai` and `anthropic-quickstarts` import the MCP SDK in source while the MCP adapter reads
   configuration files. Each names the framework and the adapter, which is a work item for a deterministic reader, not
   a question for a model.
3. **Thirteen of fourteen entries parse every file in a language this build reads.** The one exception misses four
   Python files that exceed the size limit. There is no wide unread surface for a model to interpret.

The measurement therefore points the other way from the feature: what limits breadth today is adapters that have not
been taught a form, and the corpus already names which forms and where.

## Decision

Orchescope's analysis is deterministic. Nothing in the product calls a model, and nothing in it will without a new
decision recorded here.

Removed, because each was a control or a code path that did nothing:

- the `semanticAnalysis` configuration block, and with it the `config` document at version 2;
- `semanticAnalysisDecision`, the policy gate that guarded the absent path;
- the doctor check reporting whether that path was available;
- `modelInterpretationEvidence`, an evidence builder with no producer;
- the `judge` hook on scenario evaluation, which no caller supplied;
- the optional workflow job that asserted over an empty array;
- every documentation sentence stating that the product interprets a repository with a model.

Kept, because each is a term in a versioned contract rather than a control:

- `model_interpreted` in `ClaimBasis` and its severity cap, and `model_interpretation` in the report capability list.
  Narrowing either enum would bump the graph, finding and report documents to remove a value no build has ever
  produced. The capability is now answered permanently unavailable with the reason, which is what the workspace asks
  for and what a reader who has seen an older version of this product needs to be told.
- the `model_judge` scenario evaluator kind, so a scenario file that uses it still parses and its question is still
  recorded. It is skipped with a permanent reason instead of a configurable one.

A configuration file that still carries `semanticAnalysis` is read, not refused: the key is ignored and the reason is
reported as a problem on the load. A configuration is committed to a repository, and an upgrade that fails an audit on
a setting that used to work would be honest and useless.

## Consequences

**The privacy claim becomes unconditional.** "No account, no network calls, no telemetry, no upload" no longer needs
"unless you enable model based analysis" after it. The only outbound path left in the product is a fault proxy
forwarding to a non local upstream, which is off by default and named in the permission model.

**A finding can only come from a rule.** Every claim in a report is traceable to a deterministic rule over evidence
that a second run reproduces. That is a stronger property than the one being given up, and it is the property the
corpus checks depend on.

**Breadth now has one path: an adapter, or the manifest.** The manifest remains the honest escape hatch for anything
no adapter reads, and the report of what an adapter found nothing in names which adapter to teach next.

**This decision is reversible, and here is what would reverse it.** A corpus entry in a language no parser here reads
that contains an agent system, or an adapter that keeps finding nothing after a serious attempt at it. Should either appear,
the implementation is the one phase 17 described: a bounded, opt in, content hash cached pass that reads the facts of
that file and proposes components as a manifest draft for a person or an agent to accept. Proposals, never facts. The
severity cap and the `model_interpreted` basis are still in the contract for that day.
