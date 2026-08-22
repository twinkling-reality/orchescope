# Static audit

What Orchescope can tell you without running anything, what it cannot, and how to read the difference.

```
orchescope audit --runs 0
```

`--runs 0` skips reconciliation entirely, which is the honest way to see the static side alone.

## What a static audit establishes

- **Which components exist**, from source, configuration and your manifest: agents, models, providers, prompts, tools, MCP
  servers, retrieval, memory, queues, databases, external services, approval boundaries.
- **How they are wired**: which agent calls which tool, which model each invokes, what hands off to what, which prompts are
  used, what falls back to what.
- **What is declared around a relation**: retry attempts and backoff, whether the retry is bounded, a timeout, an approval
  requirement.
- **Where each of those was found**, as a file and a line, recorded as evidence.
- **What cannot be resolved**: an MCP server whose command contains a placeholder, a tool name assembled at runtime, a
  model chosen from a variable.

## What it cannot establish

A static audit cannot know what actually happens. Specifically:

- **Whether anything is reachable in practice.** A tool configured on an agent that is never invoked looks identical to one
  used constantly.
- **Whether a declared retry ever fires**, or how many times.
- **Whether an operation is idempotent.** Nothing in the syntax says so. The idempotency status of an operation with no key
  is recorded as `unknown`, not as unsafe and not as safe.
- **What it costs, how long it takes, or how often it fails.**
- **What effects actually reach the outside world.**

Those need runs. See [runtime-tracing.md](runtime-tracing.md).

## Read the coverage block first

```json
{
  "filesDiscovered": 34,
  "filesParsed": 22,
  "truncated": false,
  "languages": [{ "language": "typescript", "files": 18 }, { "language": "python", "files": 4 }],
  "skipped": [{ "file": "assets/model.bin", "reason": "too_large" }],
  "adapters": [{ "adapterId": "adapter:langgraph", "status": "not_applicable" }],
  "unsupported": [{ "area": "go", "reason": "no adapter parses Go" }]
}
```

Thirty four files discovered, twenty two parsed. The other twelve are in the `skipped` and `unsupported` lists with a reason
each. A graph built from twenty two of thirty four files is a partial graph, and the block is how you know.

`adapters` is equally important: it names every adapter that was tried, including the ones that did not apply. If your
framework is in that list as `not_applicable`, the adapter looked and did not find its markers. If it is not in the list at
all, no adapter for it exists.

## Findings a static audit can produce

The rules that need no runs read the graph alone:

- **A retry around an operation with no established idempotency.** The strongest static finding in the tool, because the
  consequence is a duplicated external effect and the evidence is entirely in the source.
- **A model call with no declared timeout**, grouped by model rather than repeated per call site.
- **A component nothing can reach** from any entry point, restricted to control flow relations so a prompt or a model is not
  reported as unreachable for not being called.
- **A prompt that interpolates**, marked as a place where untrusted input can enter. This is a boundary, not a verdict:
  whether the substituted value is untrusted cannot be established from syntax, and the finding says so.
- **A configured tool that nothing uses.**
- **An MCP server whose declaration cannot be fully resolved.**
- **Positive findings**, such as an approval boundary in front of a financial effect, or a bounded retry with a declared key.

Each carries `basis: "discovered"`, which caps its severity at `critical` but requires the confidence to support it.

## Gate a pull request on it

```
orchescope audit --fail-on high --export-sarif findings.sarif
```

Exit code `1` when a risk at or above `high` exists, `0` otherwise. An unrecognised severity is refused with exit `2` rather
than silently never firing, which is the failure mode that makes a gate useless.

The SARIF export is what a code scanning tool reads. The JSON bundle is what to read for evidence, since SARIF has nowhere
to put it.

## Make the audit better without changing your code

`.orchescope/manifest.yaml` is a first class input. Anything you declare there becomes `manifest` presence in the graph, and
a `runtimeName` is what lets reconciliation match a component whose telemetry name differs from its source name.

`orchescope init --manifest` writes a template that lists every component kind, relation kind and side effect class the
validator accepts, and declares nothing until you fill it in:

```yaml
schemaVersion: 2
components:
  - kind: tool
    name: issue_refund
    runtimeName: issue_refund
    definedIn: src/tools/refund.ts
    definedAtLine: 24
    sideEffect: financial
  - kind: external_service
    name: payment-gateway
  - kind: mcp_server
    name: remote-tool-server
    details:
      for: mcp_server
      role: consumed
edges:
  - kind: performs_side_effect
    from: issue_refund
    to: payment-gateway
    policy:
      retry:
        maxAttempts: 3
        bounded: true
        backoff: exponential
        idempotency: absent
```

An edge endpoint is a component `name`, either declared in the same manifest or discovered from your source, so a manifest
can annotate real code rather than only describing code Orchescope cannot read.

`details` uses the same kind-specific vocabulary as automatic discovery. A consumed MCP server remains visible in the
graph, but does not by itself make the repository that connects to it an agent system. An implemented server does.

Declaring `idempotency: absent` is what turns "we cannot tell" into a finding with a known basis. Declaring it `declared`
when it is not would be lying to your own audit, and the reconciliation would catch it the first time a run duplicated an
effect.

A manifest the validator rejects is reported as a failed adapter with the field that failed, and the audit says so on the
terminal. It is never ignored.

## Performance

Discovery is incremental: parsed facts are cached by content hash, so a second audit of an unchanged tree reparses nothing.
Concurrency is bounded by `analysis.concurrency`. The scan stops at `analysis.maxFiles` and says so rather than running for
an unbounded time on a monorepo.
