# Vision

## Product claim

Orchescope is a local, deterministic test harness for AI agent systems. It records or scans the same work before and after
a change, then reports `improved`, `unchanged`, `regressed`, `mixed`, or `insufficient_evidence` from the evidence it has.

An AI agent system is software in which one or more language-model-driven agents choose steps, call tools, or hand work
to other agents. The product is for developers, CI, and coding agents that need a repeatable answer to one question: did
this change help?

This is narrower than the original audit claim. In a measured comparison, a coding agent found more checkable static
issues across both repositories. Orchescope does not compete on static finding breadth. The
[head-to-head result](../research/orchescope-against-an-agent.md) remains a product limit, and the
[judge measurement](../research/the-judge-measurement.md) is the evidence for the narrower release claim.

## The workflow

1. Record a baseline scan or scenario run.
2. Turn one eligible finding into a bounded goal, or choose one change to measure directly.
3. Make the change.
4. Repeat the same scan or scenario under the same declared conditions.
5. Compare the evidence and report a verdict.

A **baseline** is the evidence before the change. A **scenario** is a checked-in recipe for one repeatable run, including
the command, seed, repetitions, budgets, and evaluators. A source-only goal compares scans. A runtime goal compares the
same scenario twice.

The comparison verdict and goal validation are separate. The verdict says which direction the evidence moved. Validation
says whether every acceptance criterion passed. Keeping both prevents a partial improvement, a no-op, and a regression
from collapsing into the same failed boolean.

## Evidence

The judge can use:

- supported source and configuration patterns, with file and line evidence
- OpenTelemetry spans from the system while it runs
- deterministic scenario evaluators and target-reported results
- measured duration, completion, tokens, retries, interventions, and repeated effects

OpenTelemetry is a standard trace format. Orchescope joins the runtime graph derived from those spans to the graph it can
read from source. That join can show what was declared but never exercised, what ran without a matching declaration, and
where a runtime result contradicts a declaration.

The source scan is deliberately bounded. Unsupported syntax and languages are reported as coverage gaps. The runtime side
does not make the static side comprehensive. Claims about supported ecosystems stay in
[ecosystem support](../guides/ecosystem-support.md).

## Users and surfaces

| Surface | User | Job |
| --- | --- | --- |
| CLI terminal | Developer | Run a test and read a short evidence document |
| CLI `--json` | CI and coding agents | Consume one structured document per command |
| MCP | Coding agents | Call the same audit, scenario, comparison, and goal operations as tools |
| SARIF and Mermaid | CI and reviews | Export findings or a graph when another tool needs them |

MCP means Model Context Protocol, a standard way for an agent to call tools. There is no browser workspace.

## Boundaries

Orchescope is not:

- an intelligent replacement for a coding agent
- a comprehensive static auditor
- a model-answer-quality evaluator
- a hosted observability system
- an automatic fixer
- a safety certification or sandbox

The complete reasoning is in [non goals](non-goals.md).

## Principles

**Evidence or silence.** Every finding states its basis and points to the source location, span, scenario result, or metric
that supports it.

**Coverage is part of the answer.** Unsupported files, missing spans, incomparable conditions, and small sample sizes are
reported instead of hidden.

**Same work twice.** A verdict compares the same source audit or the same declared scenario. Different conditions produce
`insufficient_evidence`, not an invented direction.

**Deterministic judgement.** Orchescope does not call a model. The same stable evidence and rules produce the same semantic
result. Raw documents may contain volatile timings and display IDs, which are excluded from reproducibility claims.

**Local operation.** There is no account, telemetry, or upload. State lives in the repository. A target that Orchescope
starts can still use its own network access and credentials.

**Refuse rather than weaken.** Missing permissions, missing evidence, and incompatible comparisons are named. Nothing
silently runs in a weaker mode and reports as though the stronger operation completed.

**Numbers keep their basis.** Metrics carry sample sizes. Quantiles are withheld when the sample is too small. A latency
gain beside a success loss is not called an improvement.

## Success test

The product succeeds when its printed plan separates a visible improvement, a no-op, and a visible regression on the same
work, without asking the operator to infer the answer from an unmentioned side channel.

Version 0.10.0 met that test on two pinned third-party repositories for changes inside Orchescope's measured dimensions.
It produced `improved`, `unchanged`, and `regressed` in the expected order. That result does not expand the static coverage
claim, prove answer quality, or prove safety. See [the judge measurement](../research/the-judge-measurement.md).
