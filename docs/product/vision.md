# Vision

## The problem

An agent system is easy to build and hard to know. A repository declares agents, tools, prompts, retries and fallbacks;
a running system exercises some of them, in an order nobody wrote down, with retries that may repeat effects the outside
world can see. Between the two sits a gap that nothing currently reports.

The gap is not a monitoring problem. Observability tools show what happened in production. Evaluation tools score answer
quality. Neither answers the questions a team actually asks before shipping a change:

- Which of the things we declared has any run ever exercised?
- Which of the things our runs did was never declared anywhere?
- Where does a retry sit in front of an operation whose repeat we cannot rule out?
- Did adding a third agent buy anything, or did it only add latency and tokens?
- If one tool times out, does the task degrade or collapse, and does an external effect happen twice?
- We changed something. Did it help, on measured evidence, or does it only feel faster?

## What Orchescope is

A local tool that answers those questions with evidence, on your machine, from your own runs.

Its centre is a **reconciliation**: one graph built from source and configuration, joined against one graph derived from
ingested OpenTelemetry spans, pinned to a revision, producing four deltas.

1. **Declared and never exercised.** A tool configured and never called. A fallback that no run has taken.
2. **Exercised and never declared.** A model, a service or a tool that runs but appears nowhere in the code you looked
   at.
3. **Contradicted declarations.** A retry declared as safe to repeat that repeated an effect. A timeout declared and not
   honoured.
4. **Duplicated external effects.** The same logical operation performed twice inside a single run, attributed to a
   specific retry of a specific operation.

Around that centre sit the things that make a delta actionable: scenarios that make a run repeatable, faults that make a
failure reproducible, benchmarks that vary exactly one dimension, and a goal format that states what to change, what may
be touched, and the command that decides whether it worked.

## Who it is for

- **The engineer who owns an agent system** and needs to explain, before a release, what it will do when a dependency
  fails.
- **The reviewer of an agentic pull request** who wants to know whether a new tool is reachable, whether a retry is safe,
  and what the change did to latency and cost.
- **The coding agent** doing the work, which needs a bounded task with acceptance criteria and a command that verifies
  the outcome, not a prose suggestion.

## Principles

**Evidence or silence.** Every claim names what it came from and how it was established: observed in a trace, discovered
in source, inferred by a rule, estimated from a model of the system, simulated under an injected fault, or interpreted by
a language model and reviewed. A finding with no evidence is not reported.

**Say what you could not see.** Coverage is part of the output. Files that could not be parsed, languages with no
adapter, a scan that hit its limit, a quantile withheld for want of samples: all stated, every time. Silence about a gap
reads as an absence of problems.

**Deterministic first.** Parsing, graph construction, reconciliation and rule evaluation are deterministic and reproduce
byte for byte. A language model is optional, off by default, used only where a deterministic method cannot reach, and its
output is reviewed against evidence before it becomes a finding.

**Local by default.** No account, no telemetry, no gateway, no upload. Servers bind to loopback. State lives inside the
repository being audited.

**Refuse rather than downgrade.** An operation the configuration has not granted is refused with the name of the setting
that would grant it. Nothing quietly runs in a weaker mode and reports as though it ran in the stronger one.

**A number without its uncertainty is a lie.** Sample sizes travel with every metric, quantiles are withheld below a
threshold, and a latency improvement alongside a success decline is never reported as an improvement.

## How to tell whether it worked

The product succeeds if a team can take a finding, hand it to a person or an agent with the goal document attached, make
the change, run one command, and get an answer about whether the change helped that they are willing to act on.

That loop is covered end to end by `tests/e2e/improvement-loop.test.ts`, which discovers a duplicated refund in the
demonstration system, creates the goal, applies the fix, reruns the same scenario with the same seed, and requires the
comparison to reach `improved` from measured runs.
