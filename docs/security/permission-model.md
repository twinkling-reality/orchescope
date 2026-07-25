# Permission model

Every capability that reaches outside the analysis is a setting in `.orchescope/config.json`, decided by a pure function,
and a refusal always names the setting that would grant it. No subsystem decides for itself, and nothing runs in a weaker
mode while reporting as though it ran in the stronger one.

Write the file with defaults using `orchescope init`. It is meant to be committed: the permissions a repository grants are
a property of the repository, not of whoever happens to be running the command.

## The settings

| Setting | Default | What it grants |
| --- | --- | --- |
| `policy.allowProcessSpawn` | `true` | Starting a process at all: `trace`, `test`, `benchmark`, `chaos`. Set to `false` for a purely static audit. |
| `policy.allowedCommands` | `node`, `npm`, `npx`, `pnpm`, `yarn`, `python3`, `python`, `uv`, `deno`, `bun` | Which executables may be started. Matched by exact path or by basename. |
| `policy.allowOutboundNetwork` | `false` | Reaching anything other than loopback, which today means only a fault proxy forwarding to a non local upstream. |
| `policy.allowPaidModels` | `false` | Any operation that can incur provider cost. |
| `policy.allowFilesystemWrites` | `false` | Writing outside the Orchescope state directory, including a git worktree for a comparison. |
| `policy.maxCostUsd` | `0` | Ceiling on estimated cost for a command. Zero means anything with a non zero estimate is refused. |
| `policy.maxRunDurationMs` | `300000` | Wall clock ceiling for one run. |
| `policy.maxConcurrentRuns` | `4` | How many runs may execute at once. |
| `policy.maxTotalRuns` | `200` | Ceiling on runs in one command, which is what bounds a benchmark or chaos suite. |
| `policy.allowedChaosEnvironments` | `["local_deterministic"]` | Which chaos environments may be used. The others are `declared_test` and `live`. |
| `redaction.extraPatterns` | `[]` | Additional patterns to redact, in addition to the built in set. |
| `redaction.sensitiveEnvFragments` | `[]` | Additional environment name fragments whose values are masked. |

Analysis limits (`analysis.maxFiles`, `maxFileBytes`, `timeoutMs`, `concurrency`, `followSymlinks`, `exclude`) bound the
scan itself. Runtime limits (`runtime.maxSpansPerRun`, `maxSpanAttributeBytes`, `maxRequestBytes`, `exportDrainMs`) bound
what a receiver will accept. Report settings (`report.host`, `port`, `openByDefault`, `retainReports`) control the server;
`host` accepts only a loopback address.

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
browser workspace asks about every capability it knows and a reader deserves the answer rather than silence. The
decision, the evidence behind it and what would reverse it are in
[ADR 0002](../architecture/adr/0002-deterministic-analysis.md).

A configuration written before this decision still loads. The `semanticAnalysis` block is ignored and the load reports
that it was, rather than refusing a file that used to be valid.
