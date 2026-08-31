# CLI reference

The command line is the human and CI surface for Orchescope. Run a command with `--json` when another program will read
the result. Coding agents can use the same operations through MCP, described in
[coding agent integration](coding-agent-integration.md).

## Commands

| Command | What it does |
| --- | --- |
| `orchescope audit` | Scan the system, reconcile it with stored runs, and report findings |
| `orchescope trace -- <command>` | Run a command and store the OpenTelemetry spans it emits |
| `orchescope receive --for 10m` | Collect spans from a system that is already running |
| `orchescope test --scenario <id>` | Run a checked-in scenario and evaluate it |
| `orchescope compare <baseline> <candidate>` | Compare two runs, scans, or revisions |
| `orchescope benchmark --scenario <id> --agents 1,2,4` | Vary one dimension and compare the variants |
| `orchescope chaos --scenario <id>` | Inject the faults declared by a scenario |
| `orchescope goals` | List stored improvement goals |
| `orchescope goal create <finding-id>` | Turn one eligible finding into a bounded goal |
| `orchescope goal show <goal-id>` | Show a goal, including its evidence and validation plan |
| `orchescope goal validate <goal-id>` | Report the before-and-after verdict and acceptance criteria |
| `orchescope federate --repository <path>...` | Join separately scanned repositories using runtime evidence |
| `orchescope export --format <json\|mermaid\|sarif>` | Export a report |
| `orchescope mcp serve` | Serve the Model Context Protocol tools over standard input and output |
| `orchescope init` | Write `.orchescope/config.json` with every default |
| `orchescope init --manifest` | Also write a manifest template for unsupported source shapes |
| `orchescope init --scenario` | Also write a scenario template |
| `orchescope doctor` | Check the installation and local runtime requirements |

Run `orchescope <command> --help` for the complete option list.

## JSON contract

With `--json`, each command writes one document to standard output, including on failure. Successful documents contain
`ok`, `command`, `version`, and `data`. Failed documents add an `error` object with a stable code and category.

```json
{
  "ok": true,
  "command": "audit",
  "version": "x.y.z",
  "data": {}
}
```

Run source commands through pnpm with `--silent` when capturing JSON. Without it, pnpm writes its own banner before the
document.

```sh
pnpm --silent orchescope --cwd apps/demo audit --json
```

An installed `orchescope` binary needs no wrapper.

## Exit status

| Status | Meaning |
| --- | --- |
| `0` | Success |
| `1` | A finding met the `--fail-on` threshold |
| `2` | Invalid input from the caller |
| `3` | Refused by policy |
| `4` | The audited system failed |
| `5` | A required local capability is missing |
| `130` | Interrupted |

`orchescope trace` normally exits with the status of the traced command. If Orchescope fails before the target starts,
the table above applies. Under `--json`, the target status is also available as `data.exitCode`.

## Standard output under `trace`

Without `--json`, the traced command keeps standard output. Orchescope writes its run diagnostic and privileges notice to
standard error. This means redirection keeps the target output intact:

```sh
orchescope trace -- generate > out.json
```

With `--json`, the Orchescope document owns standard output and the target output moves to standard error.

## Cost data

Orchescope ships no provider price table. Configure prices in `.orchescope/config.json`, keyed by the provider and model
reported by your spans:

```json
{
  "pricing": {
    "openai/gpt-4o-mini": {
      "inputPerMillion": 0.15,
      "outputPerMillion": 0.6
    }
  }
}
```

Without a matching price, Orchescope reports tokens and marks cost as unavailable. It does not report missing cost as
zero.

## Verify an installed package

```sh
npx orchescope@latest --version
npx orchescope@latest doctor
```

Maintainers who need to reproduce and compare the published archive should follow the
[release guide](release.md#after-publishing). The archive name in that guide uses a version placeholder so the command
does not go stale after a release.
