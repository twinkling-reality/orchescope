# Non goals

Each of these is a deliberate decision, not a missing feature. Where a boundary might reasonably move later, the
condition that would move it is stated.

## Not a gateway or a proxy for your traffic

Orchescope never sits between your agents and their providers in normal operation. It reads spans your system already
emits, or that it emits under `trace`.

Why: a gateway is an availability and confidentiality risk that has to be operated, and it changes the thing being
measured. The one exception is the fault proxy used by chaos runs, which exists only for the duration of a run, binds to
loopback, and refuses to forward anywhere other than loopback unless outbound network access has been granted.

## Not a hosted service

There is no account, no dashboard, no cloud storage and no telemetry.

Why: the input is your source, your prompts and your traces, which is among the most sensitive material a team has. The
only trustworthy answer to "where does my code go" is "nowhere".

This will not change. A future team feature would have to be an export you choose to send somewhere you run.

## Not an evaluation framework

Orchescope does not score answer quality, does not maintain golden answers, and does not judge whether an agent's output
was good.

Why: quality scoring is a different discipline with mature tools, and it needs domain knowledge Orchescope does not have.
What it measures instead is behaviour: did the task complete, what did it cost, how many times did it retry, what
external effects happened, and did the same effect happen twice.

A scenario can declare a deterministic evaluator over a target's own reported result, which is how a team plugs its own
notion of success in without Orchescope pretending to know it.

## Not a replacement for observability

It ingests OpenTelemetry rather than replacing it, has no alerting, no retention, no live dashboards and no production
agent.

Why: production monitoring is solved. What is not solved is joining a trace back to the declarations in a repository at a
known revision, which is what Orchescope does.

## Not a linter

Findings are about a system, not about a file. There is no style rule, no formatting opinion, and no per line diagnostic
stream.

Why: the questions worth asking span components. A retry around a non idempotent tool is not visible in either file
alone; it is visible in the relation between them.

## Not a model based reviewer

Model based analysis is off by default. When enabled it needs an explicit provider and a credential you supply, receives
bounded excerpts rather than a repository, and its output is reviewed against supplied evidence before it can become a
finding. Any finding it contributes to carries the `model_interpreted` basis, and its severity is capped accordingly.

Why: an unreproducible claim is not evidence. A tool whose findings change between runs cannot be used as a gate.

## Not a fixer

Orchescope does not edit your code. It produces a bounded goal: the problem, the evidence, the files a change may touch,
the acceptance criteria, and the command that decides the outcome. A person or a coding agent makes the change.

Why: the value is in stating the problem precisely and verifying the outcome honestly. An automatic edit that nobody
verified is a liability, and the verification is the hard part.

## Not a certification

An audit that reports no findings means the rules that had enough evidence to fire did not fire. It does not mean the
system is safe, correct or complete. Coverage is reported alongside every result for exactly this reason.

## Not a universal parser

Only ecosystems with a tested adapter are claimed, and the list is in the README. A file in an unsupported language is
reported as not inspected.

Why: a partial parse produces a partial graph that looks complete, which is worse than an honest gap. Anything not
recognised can be declared in `.orchescope/manifest.yaml`, which is a first class input.

## Not multi repository

One command works on one repository at a time. A system split across several repositories is analysed per repository,
with the manifest naming what crosses the boundary.

Why: identity and revision pinning are what make a reconciliation trustworthy, and both are defined relative to one
working tree. This is the boundary most likely to move, and moving it would need a design for cross repository identity
first.
