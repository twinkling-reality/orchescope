# ADR 0013: Every claim states the evidence population that supports it

- Status: accepted
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

The 0.9.0 finding invariant requires at least one evidence reference. It does not require that the referenced evidence
support every material clause. The blind target's acyclic strength cites node registrations and no relation or router
evidence. After runtime ingestion, the model-timeout finding cites agent node registrations for the Ollama branch. Those
locations are near the affected component and do not establish the timeout claim.

The same evidence-population ambiguity appears in reports. A strict relation exercise rate of zero is correct because the
run identifies no declared handoff with independent endpoint and trigger evidence. The human summary can still be read as
though no behavioral path ran. SQLite stores 16 spans while the export retains 13 span evidence records and states no
omission count or reason. One silent and one observed run become a human phrase naming only the observed run.

## Falsifier stated before implementation

Reject this decision unless all of these hold:

1. Every material finding clause cites evidence that entails that clause or the finding is refused with a stated reason.
2. A topology strength names the inspected evidence population and sample size.
3. A strict zero relation rate can coexist with a separate statement that components executed and no relation carried
   sufficient independent evidence.
4. Silent and observed run populations are both stated when both exist.
5. A bounded export either includes every evidence item required to reproduce its claims or states included, omitted, and
   total counts with bounded reasons.
6. Missing source identity remains a sampled refusal and cannot silently become name-based confidence.
7. The report does not present a narrow metric as a statement about a broader population.

## Decision

**Finding drafts bind material clauses to evidence.** A rule supplies the evidence for its mechanism, subject, and absence
or positive conclusion separately when those clauses rest on different facts. The engine resolves every reference against
the known evidence set, rejects an empty clause, and derives source locations only from the evidence bound to the claim.
Nearby component locations are not substituted.

A deterministic analysis may create derived evidence that records its inputs and conclusion. For example, acyclicity may
cite the complete topology population and the cycle analysis result. An absence claim requires evidence that the relevant
population was complete. It cannot cite a component declaration as proof of an absent timeout, relation, or route.

Existing version 1 finding documents remain readable. Clause bindings are producer input and do not add a required field to
the persisted finding. A versioned document change is required if consumers need to inspect clause bindings directly.

**Strict metrics retain their denominator and gain a separate behavioral account.** Reconciliation continues to credit a
declared relation only from independent relation evidence. The report also carries an optional bounded narrative fact with
the executed component population, observed structural behavior, and why no declared relation qualified. JSON, MCP, and
terminal projections label the metric and narrative separately.

**Run summaries name both populations.** A recorded command with no span is not an observed run and is not discarded when
another run produced spans. Human and machine surfaces state observed and silent counts without deriving runtime absence
from the silent population.

**Evidence exports account for omission.** A report bundle carries optional evidence coverage with total eligible items,
included items, omitted items, bounded omission reasons, and the ceiling applied. Every evidence item cited by a finding,
goal, reconciliation claim, or displayed narrative is required and cannot be omitted. Structural spans that support no
claim may be omitted only under that accounting.

The evidence coverage and behavioral account are optional additions to version 1 report and reconciliation documents.
Older documents remain readable and their missing fields mean unknown, not complete and not zero.

## Consequences

Rules do more work at their evidence boundary and report consumers do less inference. A source link points to the fact that
supports the sentence rather than to a convenient affected component.

Exports remain bounded. The bound becomes visible and reproducibility is stated against the included population.

Strict relation anti-circularity remains intact. Behavioral context makes the narrow zero useful without weakening what an
exercised relation means.

## What would reverse this

Reopen the decision if a material deterministic claim cannot name its inputs without unbounded evidence, or if the optional
report additions cannot preserve version 1 readability. In either case the claim must be shortened or refused. Expanding a
nearby citation into proof is not an alternative.
