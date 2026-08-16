# Permission model

Every capability that reaches outside the analysis is a setting in `.orchescope/config.json`, decided by a pure function,
and a refusal always names the setting that would grant it. No subsystem decides for itself, and nothing runs in a weaker
mode while reporting as though it ran in the stronger one.

Write the file with defaults using `orchescope init`. It is meant to be committed: the permissions a repository grants are
a property of the repository, not of whoever happens to be running the command.

## The settings

The `policy` block carries two kinds of setting and the difference matters. Some bound **what Orchescope itself does**.
Two bound **whether Orchescope starts your process**, and none of them bound what that process may then do. A reader who
takes the block as a whole concludes that tracing is sandboxed; it is not, and the section below the table says so
plainly.

**What Orchescope itself may do:**

| Setting | Default | What it grants |
| --- | --- | --- |
| `policy.allowOutboundNetwork` | `false` | Reaching anything other than loopback, which today means only a fault proxy forwarding to a non local upstream. |
| `policy.allowPaidModels` | `false` | Any operation that can incur provider cost. |
| `policy.allowFilesystemWrites` | `false` | Writing outside the Orchescope state directory, including a git worktree for a comparison. |

**Whether Orchescope starts your process:**

| Setting | Default | What it grants |
| --- | --- | --- |
| `policy.allowProcessSpawn` | `true` | Starting a process at all: `trace`, `test`, `benchmark`, `chaos`. Set to `false` for a purely static audit. |
| `policy.allowedCommands` | `node`, `npm`, `npx`, `pnpm`, `yarn`, `python3`, `python`, `uv`, `deno`, `bun` | Which executables may be started. Matched by exact path or by basename. A guardrail against a typo, not a security control: only `argv[0]` is checked, so `npx <anything>` runs. |

**Ceilings on the work Orchescope will do:**

| Setting | Default | What it bounds |
| --- | --- | --- |
| `policy.maxCostUsd` | `0` | Ceiling on estimated cost for a command. Zero means anything with a non zero estimate is refused. |
| `policy.maxRunDurationMs` | `300000` | Wall clock ceiling for one run. |
| `policy.maxConcurrentRuns` | `4` | How many runs may execute at once. |
| `policy.maxTotalRuns` | `200` | Ceiling on runs in one command, which is what bounds a benchmark or chaos suite. |
| `policy.allowedChaosEnvironments` | `["local_deterministic"]` | Which chaos environments may be used. The others are `declared_test` and `live`. |
| `redaction.extraPatterns` | `[]` | Additional patterns to redact, in addition to the built in set. |
| `redaction.sensitiveEnvFragments` | `[]` | Additional environment name fragments whose values are masked. |

## What none of this bounds

**A command Orchescope starts runs with your full ambient privileges.** `allowFilesystemWrites` and
`allowOutboundNetwork` constrain Orchescope's own behaviour and nothing else; `doctor` says Orchescope "makes no outbound
request **of its own**" for the same reason. They sit in the same block as `allowedCommands`, which is about the target,
and that is a genuine ambiguity in the file rather than a subtlety a careful reader would resolve.

So: when `trace`, `test`, `benchmark` or `chaos` starts your system, that system writes the files it always writes, binds
the ports it always binds and reaches the network it always reaches. Orchescope adds environment variables and, for a
Node target, loads its own instrumentation into the process. It takes nothing away, and it is not a sandbox. If you need
one, run the whole command inside it.

Analysis limits (`analysis.maxFiles`, `maxFileBytes`, `timeoutMs`, `concurrency`, `followSymlinks`, `exclude`) bound the
scan itself. Runtime settings place the OTLP trace receiver and bound what it accepts: `runtime.receiverHost` takes only
`127.0.0.1` or `::1` and `receiverPort` defaults to a port the operating system chooses, while `maxSpansPerRun` caps the
spans one run holds, `maxSpanAttributeBytes` caps one attribute value, `maxRequestBytes` caps one request body, and
`exportDrainMs` is the grace period for spans still in flight when a traced process exits.

The `report` block (`host`, `port`, `openByDefault`, `retainReports`) grants nothing and bounds nothing. It configured
the browser workspace and the loopback server that served it, both of which were removed, and no code reads it. It is
accepted so that a configuration written before that removal still loads, and `orchescope init` writes it because it
writes the whole default document; an absent section takes the default, so deleting it from a file changes nothing.

## Scenario permissions

A scenario declares what it needs, and the declaration is checked before anything executes:

| Permission | Granted by |
| --- | --- |
| `process:spawn` | `policy.allowProcessSpawn` |
| `network:loopback` | always allowed: this is how a target reports its own telemetry |
| `network:outbound` | `policy.allowOutboundNetwork` |
| `model:paid` | `policy.allowPaidModels` |
| `filesystem:write` | `policy.allowFilesystemWrites` |

A scenario that needs a permission the project has not granted is refused before the target starts. It is not run in a
reduced form.

## What a refusal looks like

```
$ orchescope test --scenario support-desk
error Scenario support-desk was refused: the scenario requires model:paid
  Set policy.allowPaidModels in .orchescope/config.json if you intend to allow this.
```

Exit code `3`. With `--json`, the same refusal is one document:

```json
{
  "ok": false,
  "error": {
    "code": "POLICY_DENIED",
    "category": "policy",
    "message": "Scenario support-desk was refused: the scenario requires model:paid",
    "detail": { "setting": "policy.allowPaidModels" }
  }
}
```

The `detail.setting` field is there so a script or a coding agent can act on it without parsing prose.

## Chaos environments

Three, and only the first is enabled by default:

- **`local_deterministic`.** Faults are applied by the target itself from a seed handed to it, so a result is reproducible
  and attributable to one fault. Nothing reaches a real dependency.
- **`declared_test`.** A dedicated test environment the operator has declared. Requires adding it to
  `allowedChaosEnvironments`.
- **`live`.** A real environment. Requires adding it to `allowedChaosEnvironments`, and every cost and duration ceiling
  still applies.

Even with `live` enabled, nothing here makes chaos testing safe. It causes real failures on purpose, and a duplicated
external effect is one of the outcomes it measures.

## Approvals in a goal

A goal can require an approval before it is acted on: `human_review`, `live_execution` or `cost_budget`. These are recorded
on the goal and shown wherever it is rendered. Orchescope does not enforce them, because it does not perform the change; it
states them so the person or the agent doing the work knows what has to happen first.

## Model based analysis, specifically

There is none. Nothing in Orchescope calls a model, so there is no setting to grant it and no credential to supply. The
report still answers the `model_interpretation` capability, permanently unavailable and with that reason, because the
report bundle answers every capability it knows and both the terminal document and the agent interface read that answer:
a reader deserves the reason rather than silence. The decision, the evidence behind it and what would reverse it are in
[ADR 0002](../architecture/adr/0002-deterministic-analysis.md).

A configuration written before this decision still loads. The `semanticAnalysis` block is ignored and the load reports
that it was, rather than refusing a file that used to be valid.
