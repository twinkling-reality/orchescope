# Orchescope documentation

Orchescope maps an agent system from its source, ingests what it does when it runs, and reports the difference. Start
with the quickstart; read the architecture when you want to change something.

## Guides

| Guide | Read it when |
| --- | --- |
| [Quickstart](guides/quickstart.md) | You have a repository and five minutes |
| [Static audit](guides/static-audit.md) | You want to know what the audit can and cannot see without running anything |
| [Runtime tracing](guides/runtime-tracing.md) | You want the declared against exercised delta |
| [Scenario testing](guides/scenario-testing.md) | You want a repeatable run you can compare against |
| [Chaos testing](guides/chaos-testing.md) | You want to know what one failure does to the whole task |
| [Coding agent integration](guides/coding-agent-integration.md) | You work with Claude Code, Codex or another agent |
| [Adapter development](guides/adapter-development.md) | Your framework is not recognised yet |
| [The corpus](guides/corpus.md) | You changed a reader and want to know what it did to real repositories |
| [Release](guides/release.md) | You maintain this repository and are publishing a version |

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

- [Ecosystem analysis](research/ecosystem-analysis.md)
- [Competitive boundary](research/competitive-boundary.md)
- [Stack evaluation](research/stack-evaluation.md)
- [Performance spikes](research/performance-spikes.md)
