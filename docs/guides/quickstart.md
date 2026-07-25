# Quickstart

Five minutes, one repository, no configuration.

## Install

Node.js 24 or newer. No compiler, no native build. Until this is published to npm, install the tarball this repository
builds with `pnpm package`; see the README.

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

You get a summary that leads with the delta between what the repository declares and what any stored runs exercised, then
findings by severity, then what could not be inspected:

```
demo  scan_c0a73b3e48dfa164
----------------------------------------------------------------------------
* 32 components, 31 relations, 22 files parsed

Declared against exercised
  * exercised: 14 of 21 (67 percent)
  ! declared and never exercised: 7
  + exercised and never declared: 0
  + declarations contradicted by behaviour: 0
  + duplicated side effects: 0

Findings
  high     7 findings
  medium   7 findings
  low      8 findings
  + 1 strength recorded
  22 rules evaluated: 9 clear, 3 lacked evidence
```

Read the last line before the findings. Nine rules ran and found nothing, three could not decide because they lacked
evidence, and that is different from nine clear results.

If nothing was detected, the output says so and points at `.orchescope/manifest.yaml`, which is how you declare a system no
adapter recognises. See [adapter-development.md](adapter-development.md).

## Open the report

```
orchescope audit --open
```

The report is served from loopback with a one time token in the URL and opened in your browser. Without `--open` it prints
the URL and waits; `--serve` serves without opening anything.

Eight sections: overview, system map, findings, performance, resilience, scenarios, comparisons, goals. The map has a
keyboard navigable table beside it with the same components, so nothing is only available by pointing at a canvas.

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
pnpm orchescope --cwd apps/demo audit --open
```

It has deliberate weaknesses, including a retry around a refund whose idempotency is not established, so the report has
something to show.

## Where to next

- [static-audit.md](static-audit.md): what the audit can and cannot see without running anything.
- [runtime-tracing.md](runtime-tracing.md): getting spans in, including from a system that does not emit them yet.
- [scenario-testing.md](scenario-testing.md): making a run repeatable.
- [chaos-testing.md](chaos-testing.md): what one failure does to the whole task.
- [coding-agent-integration.md](coding-agent-integration.md): wiring this into Claude Code or Codex.
