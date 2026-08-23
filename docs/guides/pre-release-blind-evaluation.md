# Pre-release blind evaluation

The regression corpus answers whether a known behavior moved. It cannot answer whether a release generalizes to a
repository its authors did not use while implementing it. Every release candidate therefore has a frozen blind
evaluation between the ordinary release gates and publication.

## Three populations with different jobs

- **Regression corpus:** repositories already used to develop or correct Orchescope. Their pinned expectations protect
  known behavior, but they are not evidence that a new release generalizes.
- **Frozen holdout:** an agent application selected only after the release-candidate commit is frozen. It is measured
  once with the installed package built from that commit.
- **Negative control:** agent-adjacent tooling selected under the same boundary. It may discuss, operate, or observe
  agents, but it must not become an agent system without qualifying implementation evidence.

A holdout is unseen only when its URL, revision, source, and expected answer were absent from the corpus, fixtures,
research notes, implementation work, and development discussion before the freeze. Local Deep Researcher and every
other repository already named by this repository are regression inputs, never holdouts.

The [blocked a38ed43f evaluation](../research/a38ed43f-blocked-blind-evaluation.md), the
[blocked 604fce75 evaluation](../research/604fce75-blocked-blind-evaluation.md), the
[blocked 48828a1d evaluation](../research/48828a1d-blocked-blind-evaluation.md), the
[blocked df99c97c evaluation](../research/df99c97c-blocked-blind-evaluation.md), the
[blocked d00a06b5 evaluation](../research/d00a06b5-blocked-blind-evaluation.md), and the
[passed 95c7756c evaluation](../research/95c7756c-passed-blind-evaluation.md) are durable records of completed
applications of this protocol. Every repository selected in a completed evaluation, and its source lineage, is
part of a used population. Those repositories and their source lineages are permanently ineligible as blind holdouts
at any revision. A blocked candidate can be refrozen only after a generalized correction, and every candidate requires
a different unseen positive and negative pair.

## Freeze and independent selection

1. Finish the implementation, commit the candidate, record its exact 40-character revision, and prove the worktree is
   clean.
2. From that committed revision, run every documented release gate. A gate that writes the worktree invalidates the
   freeze.
3. Run `pnpm package` from that revision. Record the tarball path and the SHA-256 file beside it.
4. Give an evaluator who did not implement the change only:
   - the installed tarball and its checksum;
   - this protocol; and
   - the exact URL and full revision of each target after the evaluator has selected them.
5. The evaluator selects one bounded, licensable, unseen agent application and one bounded, licensable, unseen
   agent-adjacent negative control. Selection happens after the release-candidate revision is fixed. The implementer
   cannot nominate either target.
6. Before measurement, record why the positive is an implemented agent application, why the negative is only adjacent,
   the licence path and digest for each, and the search proving neither target occurs in the corpus or development
   record.

The evaluator installs the tarball into a clean temporary prefix and invokes that installed binary. Source commands
such as `pnpm orchescope` are not release evidence. The checksum must equal the one produced from the frozen candidate.

## Measurement boundary

Keep both target checkouts pinned and record their clean status before and after the evaluation. Treat their source,
configuration, model output, tool output, and runtime data as untrusted.

Write every raw command output to an evaluator-owned results directory outside both target checkouts. Retain the exact
commands, environment names with values redacted, package checksum, target revisions, exit statuses, JSON documents,
human documents, exported evidence, and hashes of those files. Do not rewrite a raw result to make a comparison easier.

At minimum, inspect the following for both targets where the target supplies the relevant population:

- installation and `doctor` output from the installed package;
- static audit JSON and human output under colour and `NO_COLOR`;
- component identities, relations, adapter applicability, skipped inputs, topology completeness, findings, citations,
  metrics, and evidence coverage;
- a bounded runtime audit when the positive target has an independently justified execution path; and
- the target worktree status, so environment effects are distinguishable from source changes.

An execution that cannot be justified or bounded is not guessed. The evaluator records the unsupported boundary and
continues with the evidence the target actually supplies.

## Release decision

Block publication when the evidence shows any of these:

- a component or provider has the wrong identity;
- an absence-based strength can be reversed by unresolved applicable evidence;
- a semantic finding identifier changes because an unrelated finding or input order changed;
- a material claim cites evidence that does not support that claim;
- an applicable adapter completes with zero output, disappears from the report, and its silence is used as absence
  evidence; or
- a metric or narrative is presented as applying to a broader population than its stated sample.

Do not block publication merely because Orchescope refuses an unsupported construct with a bounded reason and does not
turn the refusal into a positive claim. An honest refusal is an evidence boundary, not a failed support promise.

No Orchescope source changes while the holdout is measured. If triage requires a product fix, the result is no longer
blind: generalize the defect, add a deterministic invariant, fix it, freeze a new candidate, and have the independent
evaluator select a different positive and negative pair. Reusing the target that caused the fix would be regression
testing and cannot clear the blind gate.

After triage, promote the used positive to the regression corpus at its exact revision whether it passed or exposed a
defect. Record only expectations whose fields were read against the source and raw output. A target that exposed a defect
becomes a regression only with the generalized fix and cannot clear the blind gate; the new frozen candidate still needs
a different unseen positive and negative pair. Each release selects a different unseen holdout. A negative control
joins the corpus only when it contributes a distinct, reviewable precision invariant.

## Metamorphic gate

`pnpm test:metamorphic` runs the invariants that must hold independently of one selected repository. These tests remain
inside `pnpm verify`; the named command makes the release boundary reviewable without replacing the frozen holdout.

| Property | Executable witness |
| --- | --- |
| Unrelated findings do not change semantic identifiers. | `packages/findings/test/semantic-identity.test.ts`, `does not change an existing identifier when an unrelated finding is added` |
| Unresolved topology cannot produce absence-based strengths. | `packages/findings/test/topology-completeness.test.ts`, `suppresses reachability and topology strengths when a conditional destination is unresolved` |
| Import aliases do not change component kind. | `packages/discovery/test/framework-provider-identity.test.ts`, `preserves imported aliases and registrations on verified local framework receivers`; `packages/discovery/test/provider-qualified-effects.test.ts`, `preserves direct, renamed, namespace, default-member and Pool Postgres constructions` |
| A generic constructor name cannot establish provider identity. | `packages/discovery/test/runtime-symbol-matching.test.ts`, `rejects wrong providers, type-only origins, missing origins and explicit shadows`; `packages/discovery/test/provider-qualified-effects.test.ts`, `rejects direct and module aliases from httpx, local and type-only Client definitions, and missing origin` |
| Documentation prose does not become an executable prompt. | `packages/discovery/test/documentation-strings.test.ts`, `ignores prompt-like wording in formal Python documentation strings` |
| Runtime configuration can change an exact model without rewriting the static declaration. | `tests/e2e/configurable-model-effects.test.ts`, `keeps static llama3.2 possibilities distinct from an exact observed smollm2 model` |
| Completed-zero applicable adapters remain visible. | `packages/discovery/test/configurable-producers.test.ts`, `persists exact completed-zero applicability and uses it for the existing gap accounting` |
| Input order does not change semantic identity or selected evidence. | `packages/findings/test/semantic-identity.test.ts`, `ignores component, edge and evidence order as well as prose, severity and time`; `packages/report/test/evidence-selection.test.ts`, `is invariant to evidence and citation permutations` |
| Every strength names the evidence population supporting its scope. | `packages/findings/test/static-rules.test.ts`, `binds a complete caller-population absence to a universal approval strength`; `packages/findings/test/runtime-rules.test.ts`, `binds the aggregate component population to the subject of a coverage claim`; `packages/findings/test/experiment-evidence.test.ts`, `does not invent absent cost or retry ratios for a complete strength` |
| Workflow registration does not establish agent identity or an agent handoff. | `packages/discovery/test/adapters.test.ts`, `discovers the graph as a workflow and every registered node as a workflow step` |
| Polling and explicit non-success loops do not establish an ambiguous-failure retry. | `packages/discovery/test/retry-reading.test.ts`, `does not attach retry policy to offset commits, OAuth polling, or bounded pairing` |
| Unknown or aggregate operation identity cannot support a definite duplicate-effect claim. | `packages/findings/test/static-rules.test.ts`, `stays quiet when the effect class itself is unknown`; `does not transfer an aggregate provider effect through a generic helper` |
| A retry experiment names only a matching repository scenario. | `packages/findings/test/static-rules.test.ts`, `names a repository scenario only when it faults this operation and checks duplicates` |
| A function-scoped provider import cannot authorize a sibling scope or invent a dynamic compatible provider. | `packages/discovery/test/nested-module-binding.test.ts`, `discovers function-scoped namespace clients without inventing a dynamic compatible provider`; `does not grant one function-scoped namespace import to another lexical scope` |
| A branch-local provider client cannot authorize an ambiguous post-join call. | `packages/discovery/test/nested-module-binding.test.ts`, `refuses a provider identity after competing branch-local clients join`; `keeps calls inside their own client branch while refusing its dynamic provider` |
| An unsettled model-client binding preserves an enclosing agent boundary only when every reachable receiver binding is a recognized model client. | `packages/discovery/test/nested-module-binding.test.ts`, `explains an unsettled call when only one branch has a recognized client`; `refuses alternate control-flow clients while keeping straight-line settlement`; `refuses a JavaScript client whose later assignment is not source-settled` |
| An external effect belongs to the smallest authoritative callable, never a borrowed module or surrounding scope. | `packages/discovery/test/adapters.test.ts`, `attributes every request to the smallest named object callable`; `keeps a direct top-level request at module scope`; `refuses to invent module ownership for a request inside an unnamed callback`; `tests/e2e/object-method-effects.test.ts`, `keeps the caller, service, finding, citation and Mermaid label on the method` |
| An Agent construction uses only its direct stable source binding, and its relations stay inside that lexical scope. | `packages/discovery/test/adapters.test.ts`, `resolves reused variable names only inside their named function`; `distinguishes same-name constructions and preserves a proven same-variable self-handoff`; `does not borrow a containing result variable for a nested Agent construction`; `binds only the outer construction when the same constructor is nested`; `refuses a Python Agent clone when the fact retains only the chained call` |

The deterministic fixtures falsify one assumption at a time. The independently selected positive and negative prevent
those author-controlled fixtures from becoming the evidence that a candidate generalizes.
