# ADR 0011: Finding identifiers derive from semantic subjects

- Status: accepted
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

Finding identifiers are handles in the improvement loop. A goal stores the selected finding identifier. CLI and MCP
commands accept it. Reports, comparison deltas, SARIF fingerprints, conflicts, and persisted rows repeat it.

The 0.9.0 engine assigns a sequence inside each category after sorting one scan's finding drafts. The ordering is
deterministic and the identity is not durable. On the blind target, `OSC-ARCH-0001` names the `topology-shape` strength
before runtime evidence is ingested and the `exercised-not-declared` risk afterward. The strength moves to
`OSC-ARCH-0002`. A handle changed meaning because an unrelated finding entered the category.

The version 1 finding and goal schemas already describe finding identifiers as stable and accept the shape
`OSC-[A-Z]{3,5}-dddd`. Stored documents use that shape. Replacing the generator is a correction to the producer's
documented invariant. Changing the grammar would instead require coordinated finding, report, and goal document
versions.

## Falsifier stated before implementation

Reject this decision unless all of these hold:

1. Adding or removing an unrelated finding does not change any existing identifier.
2. Adding runtime evidence cannot give an existing identifier to a different rule, polarity, situation, or subject.
3. A strength and a risk cannot share an identifier.
4. Two simultaneous findings from one rule remain distinct.
5. The same semantic input in a different component, edge, or evidence order produces the same identifier.
6. A goal created after a rerun selects the same semantic finding the operator selected before the rerun.
7. Version 1 findings, reports, and goals containing sequential identifiers remain readable.
8. An identifier collision produces a refusal and never an alias or scan-order suffix.

## Decision

**A finding identifier is a digest projection of a semantic key.** The key contains only stable domain inputs:

- rule identity;
- polarity;
- the rule-defined situation;
- the remediation branch when one exists;
- a canonical bounded subject identity; and
- a rule-defined evidence discriminator only when two simultaneous claims over the same subject genuinely require it.

A grouped pattern uses its occurrence key as the bounded subject. It does not use the expanding list of every affected
component. An ungrouped component or relation finding uses the sorted complete component and relation identities. A
whole-system claim supplies a rule-owned subject token. Title, explanation, severity, confidence, timestamps, display
order, and evidence array order do not participate.

The SHA-256 digest of the canonical key is projected into the existing identifier grammar as five uppercase letters and
four decimal digits after `OSC-`. That grammar provides 118,813,760,000 possible tokens. Category remains an explicit
field on every finding and is not decoded from the identifier. The generator checks the complete set for a collision and
refuses the finding set if two different semantic keys project to one token. It never resolves a collision by order.

**Rules name their situation.** The engine must not derive semantic identity from prose. Each draft declares the stable
situation it reports. Grouping retains that situation and occurrence key. An optional discriminator is reviewable at the
rule that needs it.

**Display order remains separate.** Severity, polarity, goal readiness, blast radius, and identifier may order the report.
None of them assigns identity.

**Legacy documents stay readable.** No schema version moves because the accepted string grammar and the documented stable
meaning do not change. Existing sequential identifiers remain valid historical handles inside their stored scan. A legacy
goal whose finding identifier differs from the semantic identifier in a subsequent scan is matched by its stored rule and
canonical affected subject, which are already copied into the goal. That compatibility path is explicit and does not let
an old identifier select a different rule or subject.

## Consequences

Finding identity no longer explains report order. Operators use the category field and displayed severity for that.

A wording, confidence, or severity correction can retain identity when the rule, situation, polarity, and subject remain
the same. A rule split or a remediation branch change produces a different identity because it changes the claim a goal
would address.

A collision fails loudly. The failure is preferable to two findings sharing a goal handle, and it is bounded by the fixed
finding population already produced by the rules.

## What would reverse this

Reopen the decision if a real scan reaches the projection collision boundary, if a rule cannot state a stable situation
without copying prose, or if a grouped pattern needs the unbounded affected-component population to retain its meaning.
In that case the finding, report, and goal documents must advance together to carry a longer identifier. Scan-order
allocation is not an acceptable fallback.
