# Orchescope documentation

Orchescope is a local test harness for AI agent systems. It compares the same work before and after a change and reports
an evidence-backed verdict. Start with the quickstart. Use the reference guides when you need command, ecosystem, or
security detail.

## Guides

| Guide | Read it when |
| --- | --- |
| [Quickstart](guides/quickstart.md) | You have a repository and five minutes |
| [CLI reference](guides/cli-reference.md) | You need commands, JSON output, exit status, or cost configuration |
| [Ecosystem support](guides/ecosystem-support.md) | You need the exact tested source and runtime coverage |
| [Static audit](guides/static-audit.md) | You want to know what the audit can and cannot see without running anything |
| [Runtime tracing](guides/runtime-tracing.md) | You want the declared against exercised delta |
| [Repository federation](guides/federation.md) | One traced system crosses independently versioned repositories |
| [Scenario testing](guides/scenario-testing.md) | You want a repeatable run you can compare against |
| [Chaos testing](guides/chaos-testing.md) | You want to know what one failure does to the whole task |
| [Coding agent integration](guides/coding-agent-integration.md) | You work with Claude Code, Codex or another agent |
| [Adapter development](guides/adapter-development.md) | Your framework is not recognised yet |
| [The corpus](guides/corpus.md) | You changed a reader and want to know what it did to real repositories |
| [Release](guides/release.md) | You maintain this repository and are publishing a version |
| [Changelog](../CHANGELOG.md) | You want to know what moved between two versions, and what will move under you |

## Product

- [Vision](product/vision.md): what this is for and who it is for.
- [Non goals](product/non-goals.md): what it deliberately is not, and why.

## Architecture

- [Overview](architecture/overview.md): the layers, the data flow, the decisions that shape everything else.
- [Module boundaries](architecture/module-boundaries.md): what each package owns and what it may depend on.
- [System graph](architecture/system-graph.md): the model, and why identity is not a line number.
- [Discovery lifecycle](architecture/discovery-lifecycle.md): file to fact to draft to component.
- [Runtime observation](architecture/runtime-observation.md): spans to topology to reconciliation.
- [Finding lifecycle](architecture/finding-lifecycle.md): rule to draft to finding, and how severity is bounded.
- [Goal lifecycle](architecture/goal-lifecycle.md): finding to goal to verified change.
- [Mapping architecture](architecture/mapping-architecture.md): where breadth comes from as agent systems
  proliferate, staged, with what falsifies each stage.
- [Decision records](architecture/adr/): why the stack is what it is.

## Protocols

Every persisted document is versioned and emitted as JSON Schema under `schemas/`.

- [System graph schema](protocols/system-graph-schema.md)
- [Finding schema](protocols/finding-schema.md)
- [Scenario schema](protocols/scenario-schema.md)
- [Goal schema](protocols/goal-schema.md)

## Security

- [Threat model](security/threat-model.md): assets, boundaries, controls, and what is out of scope.
- [Permission model](security/permission-model.md): what each setting grants, and what a refusal looks like.
- [Data handling](security/data-handling.md): what is stored, where, for how long, and what redaction does.

## Research

The evidence behind the product and stack decisions, recorded with sources and measurements.

- [Orchescope against an agent](research/orchescope-against-an-agent.md): the measured static breadth loss and the reason
  the product claim narrowed.
- [The judge](research/the-judge.md): the design for the before-and-after verdict.
- [The judge measurement](research/the-judge-measurement.md): the evidence behind the 0.10.0 release claim.
- [The runtime join on code this repository did not write](research/runtime-join-on-third-party-code.md)
- [Ecosystem analysis](research/ecosystem-analysis.md)
- [Competitive boundary](research/competitive-boundary.md)
- [Stack evaluation](research/stack-evaluation.md)
- [Performance spikes](research/performance-spikes.md)
