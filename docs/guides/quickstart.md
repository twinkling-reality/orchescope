# Quickstart

This guide compares the same work before and after one change. It uses a scenario because runtime evidence is the clearest
way to see what Orchescope is for.

An **AI agent system** is software in which language-model-driven agents choose steps, call tools, or hand work to other
agents. A **scenario** is a checked-in recipe for running one piece of that system. A **baseline** is the result before a
change.

## Install

Node.js 24 or newer is required.

```sh
npm install -g orchescope
orchescope doctor
```

`doctor` checks the Node version, parsers, local store, and loopback trace receiver. It does not run your agent system.

## Create a repeatable scenario

From the root of the agent system:

```sh
orchescope init --scenario
```

This writes `.orchescope/scenario.yaml`. Fill in `target.command` with a command that completes on its own. Then move the
file into the directory Orchescope reads:

```sh
mkdir -p scenarios
mv .orchescope/scenario.yaml scenarios/support-desk.yaml
```

Set its `id` to `support-desk` and describe the work it runs. Keep the seed, repetition count, budgets, and evaluators in
the file so both sides of the comparison use the same conditions. The
[scenario testing guide](scenario-testing.md) explains every field and how the target can report success.

## Record the baseline

```sh
orchescope test --scenario support-desk
```

The result prints a run ID. Save it as the baseline. Orchescope reports the sample size behind each metric and withholds
statistics that do not have enough samples.

## Make one change and rerun

Change the agent system, then run the same scenario again:

```sh
orchescope test --scenario support-desk
```

This prints the candidate run ID. Compare it with the baseline:

```sh
orchescope compare <baseline-run-id> <candidate-run-id>
```

The verdict is one of:

| Verdict | Meaning |
| --- | --- |
| `improved` | At least one judged dimension improved and none regressed |
| `unchanged` | No judged dimension moved enough to call |
| `regressed` | At least one judged dimension got worse |
| `mixed` | Improvements and regressions are both present |
| `insufficient_evidence` | The runs are not comparable or do not contain a decidable signal |

A faster run is not called an improvement when task success fell. For events that must never happen, such as a repeated
external side effect, crossing from present to absent is a categorical change rather than a statistical claim.

## Add source and runtime evidence

Run an audit after you have a stored run:

```sh
orchescope audit
```

The audit scans supported source patterns and joins them to what the run exercised. It can report declarations that no
run exercised, runtime components that the scan did not declare, contradictions, and repeated effects.

The scan is not comprehensive. Read its coverage before relying on a finding count. The coverage names files it parsed,
skipped, or could not inspect and adapters that did or did not apply. See
[ecosystem support](ecosystem-support.md) and [static audit](static-audit.md).

If the system already emits OpenTelemetry, `orchescope trace -- <command>` can collect those spans without a scenario.
**OpenTelemetry** is a standard format for traces that describe what a program did while it ran. See
[runtime tracing](runtime-tracing.md) for instrumented and uninstrumented systems.

## Turn a finding into a measured goal

```sh
orchescope goals
orchescope goal create <finding-id>
orchescope goal show <goal-id> --prompt
```

The prompt gives a person or coding agent the evidence, allowed paths, acceptance criteria, and validation commands. A
runtime goal reruns the recorded scenario. A source-only goal compares the scan before the change with the scan after it.

Follow the commands printed in the goal. The final command reports both the comparison verdict and whether every
acceptance criterion passed:

```sh
orchescope goal validate <goal-id>
```

Those are different questions. A change can be `improved` without fully clearing the finding it targeted.

## Use it from CI or a coding agent

Every command accepts `--json`. An installed binary writes one JSON document to standard output:

```sh
orchescope audit --json
```

When running the source build through pnpm, add `--silent` so pnpm does not put a banner before the JSON:

```sh
pnpm --silent orchescope --cwd apps/demo audit --json
```

`orchescope mcp serve` exposes the same operations through the **Model Context Protocol (MCP)**, a standard way for a
coding agent to call tools. See [coding agent integration](coding-agent-integration.md).

## Try the offline demonstration

The repository contains a small agent system with deliberate weaknesses. It needs no credentials or paid model.

```sh
git clone https://github.com/twinkling-reality/orchescope
cd orchescope
pnpm install
pnpm orchescope --cwd apps/demo test --scenario support-desk
pnpm orchescope --cwd apps/demo audit
```

Before running your own system, read the safety warning in the [README](../../README.md#privacy-and-safety). Orchescope is
not a sandbox, and a command it starts keeps your account's privileges.
