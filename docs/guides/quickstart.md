# Quickstart

Five minutes, one repository, no configuration.

## Install

Node.js 24 or newer. No compiler, no native build.

```
npm install -g orchescope
```

```
orchescope doctor
```

`doctor` checks that this machine can run everything this build offers: the Node version, the bundled SQLite version, both
parsers, the store, and the loopback receiver. Anything that fails is reported with what to do about it.

## Audit

From the root of a repository containing an agent system:

```
orchescope audit
```

One document, on standard output, and nothing on standard error once the work is done. A line's first
column says what kind of line it is, a line that has a state says it in a second column, and the rest
says the one sentence about it, so `grep` and `awk` read it as well as a person does:

```
demo            this project has 5 agents, 7 tools and 2 models
                read from 23 of 23 files, with 10 runs on record

problems        3 serious, 6 medium, 11 minor, worst first
serious         tool_timeout on issue_refund: an outside effect happened twice
serious         issue_refund is retried and nothing makes it safe to repeat
serious         refund happened 2 times in one run
more            17 more problems: orchescope audit --verbose

missing         a verdict: the last comparison did not settle it
run             orchescope test --scenario support-desk --repeat 5
```

That is the default glance, and it answers four questions in the order a reader asks them.

- **What was audited.** The project name in column one, and what the project turned out to contain.
  Agents, tools and models are named because they are what makes it an agent system; the part and link
  counts a graph would report are on `--verbose`. The second line is coverage, and whether anything has
  ever run.
- **What is wrong.** The three worst problems, worst first, keyed by how bad each one is. `serious`
  covers critical and high, `minor` covers low and info; the five severities the engine records are
  exact and they are in `--verbose`, `--json` and MCP.
- **What is still missing.** An audit is inventory. The `missing` row names the thing the loop would
  produce and has not, which is the honest half of what this product claims.
- **What to run.** One command, and it sits directly under the reason it is worth running.

The five step loop, the reconciliation deltas, evidence bases, confidences and finding identifiers are
on `orchescope audit --verbose`, and all of them are always in `audit --json` and MCP for agents.

A repository where nothing was detected still gets a plain refusal, and the `missing` row is about the
command printed under it rather than about a loop that has not started:

```
express         this project has 5 parts
                read from 141 of 141 files, with no runs on record
No agent system was detected: nothing looked like an agent, tool, or model.

problems        1 medium
medium          No runtime evidence has been collected

missing         a description of this project that this build can read
run             orchescope init --manifest
```

That writes `.orchescope/manifest.yaml` with the component kinds, edge kinds and side effect classes the validator
accepts, and declares nothing until you fill it in. A manifest the validator rejects is reported as a failed adapter with
the field that failed, never ignored. See [adapter-development.md](adapter-development.md).

## Agents and the same facts

The terminal is the human document. Coding agents should use `orchescope audit --json` or
`orchescope mcp serve`: both return loop standing, the one next action, capabilities, and the answer to
"did my last change help", so an agent does not scrape the terminal.

That last one is `data.outcome`, and it takes no identifier, because an agent that has to already hold a
goal id cannot ask the question after a fresh session:

```json
{
  "verdict": "unchanged",
  "verdictReason": "no metric moved enough to call",
  "decided": false,
  "goals": [
    {
      "goalId": "OSC-GOAL-0001",
      "validated": false,
      "blockedBy": ["the finding this goal was created from still fires after the rescan"]
    }
  ]
}
```

`decided` is the field that matters. `unchanged` and `insufficient_evidence` are refusals, not results,
so a caller that branches on `verdict` alone will read a refusal as an answer. `blockedBy` names why a
goal did not validate, which is the part an agent can act on.

## Add runtime evidence

A static audit can tell you what exists. It cannot tell you what runs. Run your system under `trace`:

```
orchescope trace -- node src/main.js
orchescope audit
```

`trace` starts a receiver on loopback, exports its address to your process as both `ORCHESCOPE_OTLP_ENDPOINT` and
`OTEL_EXPORTER_OTLP_ENDPOINT`, runs the command, waits for the exporter to drain, and stores the spans as a run. If your
system already emits OpenTelemetry, this works with no code change. If it does not, see
[runtime-tracing.md](runtime-tracing.md).

The second audit now has both sides, and the delta becomes the interesting part of the report.

## Act on a finding

```
orchescope goals
orchescope goal create OSC-REL-0004
orchescope goal show OSC-GOAL-0001 --prompt
```

The prompt is what you hand to a coding agent or paste into an issue. It states the problem, the evidence, the paths that
may be written, what must not change, the acceptance criteria, and the command that decides the outcome.

## Verify the change

```
orchescope test --scenario support-desk
orchescope compare <baseline-run-id> <candidate-run-id> --goal OSC-GOAL-0001
orchescope goal validate OSC-GOAL-0001 --comparison <comparison-id>
```

The comparison reports per metric direction with sample sizes, and refuses to call a latency win an improvement when task
success declined. The validation reports each criterion as satisfied, refused or undecided, with a reason.

## Try it on the demonstration system

If you want to see the whole loop before pointing it at your own code, the repository contains a small multi agent system
that runs offline with no credentials. From a clone of this repository:

```
pnpm install
pnpm orchescope --cwd apps/demo test --scenario support-desk
pnpm orchescope --cwd apps/demo audit
```

It has deliberate weaknesses, including a retry around a refund whose idempotency is not established, so the report has
something to show.

## Where to next

- [static-audit.md](static-audit.md): what the audit can and cannot see without running anything.
- [runtime-tracing.md](runtime-tracing.md): getting spans in, including from a system that does not emit them yet.
- [scenario-testing.md](scenario-testing.md): making a run repeatable.
- [chaos-testing.md](chaos-testing.md): what one failure does to the whole task.
- [coding-agent-integration.md](coding-agent-integration.md): wiring this into Claude Code or Codex.
