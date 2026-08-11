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

One document, on standard output, and nothing on standard error once the work is done. A line's first
column says what kind of line it is, its second says what state that thing is in, and its third says
the one sentence about it, so `grep` and `awk` read it as well as a person does:

```
demo            33 components, 32 relations, 23 of 23 files read

1 audit         + done       21 of 22 checks ran
2 goal          + done       2 jobs written up
3 rerun         + done       1 of 3 scenarios has been run
4 measure       + done       10 runs recorded
                             8 faults injected, 1 broke the task
5 did it help   ! undecided  unchanged: no metric moved enough to call

findings        19 risks: 3 high, 6 medium, 10 low; 2 strengths
OSC-RES-0003    ! high       tool_timeout on issue_refund: a side…   1 simulated
OSC-REL-0005    ! high       Retry around issue_refund can repeat…  2 discovered
OSC-REL-0002    ! high       refund happened 2 times in one run      11 observed
OSC-REL-0003    ! medium     Model call to demo-small declares no…  4 discovered
OSC-SEC-0001    ! medium     2 consequential operations have no a…  6 discovered
OSC-ARCH-0001   ! medium     metering_record_usage runs without b…    5 observed
findings        13 more risks, in the report

join            14 of 21 declared components exercised
join            7 declared components never exercised
join            1 exercised component never declared
join            0 contradicted declarations
join            1 duplicated external effect

run             orchescope test --scenario support-desk --repeat 5
```

Findings sit above the join so the worst problem is visible before the coverage rows. `join` is the
reconciliation, and the four rows under the fraction are the four deltas this product exists to
compute. Every finding row ends with how many evidence records stand behind it and how they were
established, because a title is itself a numeric claim. There is one `run` row: the command that
advances the loop. A `next` row carries an instruction that names a file to edit, and is never a
command.

A repository where nothing was detected still gets the five step loop, the sentence saying that
nothing reported is not the same as nothing wrong, and one command that writes the manifest template:

```
run             orchescope init --manifest
```

That writes `.orchescope/manifest.yaml` with the component kinds, relation kinds and side effect classes the validator
accepts, and declares nothing until you fill it in. A manifest the validator rejects is reported as a failed adapter with
the field that failed, never ignored. See [adapter-development.md](adapter-development.md).

## Agents and the same facts

The terminal is the human document. Coding agents should use `orchescope audit --json` or
`orchescope mcp serve`: both return loop standing, the one next action, and capabilities, so an agent
does not scrape the terminal.

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
