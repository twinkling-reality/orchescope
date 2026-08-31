# Coding agent integration

Orchescope gives a coding agent a deterministic before-and-after test. It does not replace the agent's broader source
review. The same comparison and goal operations are available three ways: commands with stable JSON fields, Model Context
Protocol tools, and a goal document written to be handed over as a task.

## Register the server

```
orchescope mcp install --list
orchescope mcp install --client claude-code
```

Four clients are supported, and `--list` shows exactly which file each one writes:

| Client | File | Scope |
| --- | --- | --- |
| `claude-code` | `.mcp.json` | project, shared with anyone who checks out the repository |
| `vscode` | `.vscode/mcp.json` | workspace |
| `cursor` | `.cursor/mcp.json` | project |
| `claude-desktop` | the platform configuration path | user |

An existing entry is left alone unless you pass `--overwrite`. To run the server by hand:

```
orchescope mcp serve
```

It speaks the protocol on stdio and writes nothing to standard output that is not protocol traffic.

## The tools

Seventeen, and the read only ones are annotated as such so a client can decide what to allow without asking:

**Reading, no execution:**

| Tool | Returns |
| --- | --- |
| `get_system_map` | A page of components and adjacent edges, filterable by kind, unexercised or undeclared |
| `get_reconciliation_delta` | The four deltas and the coverage rates |
| `get_findings` | A page of findings, filterable by severity, category, polarity, component, or goal eligibility |
| `get_finding` | One finding with its evidence records |
| `get_improvement_goal` | One goal and its implementer prompt |
| `list_scenarios` | The scenarios in the repository, with what each needs |
| `export_report` | Writes a report to a path and returns the path, so a large document never fills the conversation |

**Analysing, no execution of your system:**

| Tool | Returns |
| --- | --- |
| `scan_agent_system` | Component counts by kind, edge count and the coverage block |
| `audit_agent_system` | The summary, the delta, a bounded page of findings, loop standing, the one next action (CLI argv and MCP tool when one exists), and capabilities |
| `import_trace` | Imports OTLP JSON or newline delimited spans from a path inside the repository and stores a run |
| `create_improvement_goal` | A goal and the prompt to implement it |
| `compare_runs` | A verdict with per metric directions and sample sizes |
| `validate_improvement_goal` | The comparison verdict plus per criterion outcomes |

**Executing your system**, which requires `execution.allowProcessSpawn`:

| Tool | Returns |
| --- | --- |
| `run_traced` | Runs an argv under a loopback receiver and stores the spans as a run |
| `run_scenario` | Pass or fail, run identifiers, reliability, evaluator outcomes |
| `benchmark_variants` | Per variant results with withheld quantiles named |
| `inject_faults` | Per fault outcomes and anything that could not be applied |

Every tool validates its arguments against the schema it advertises, refuses an unknown field rather than ignoring it, and
bounds its output. Nothing returns a whole graph or a whole report: they return counts, a page, and identifiers to follow up
on.

Every answer arrives twice: as `structuredContent`, which is the typed payload to read fields from, and as a text block that
mirrors it one line per record. A client that renders only text shows its reader the same findings, components and criteria,
so nothing is visible on one side and missing on the other. The text mirrors the page rather than the whole set, which is
what keeps it bounded.

## The workflow that works

The loop is designed so an agent never has to guess whether its change helped.

**1. Establish a baseline.** Prefer the next action `audit_agent_system` returns. On a repository with no runs that is
usually `run_traced` (or `import_trace` when spans already exist), or `run_scenario` when a scenario is defined. Without a
baseline there is nothing to compare against, and the comparison will say so rather than inventing one.

**2. Find something worth changing.** `audit_agent_system` again after the run, then `get_findings` with
`goalEligibleOnly: true`. Eligibility is the filter that matters: a finding needing a design decision is marked as not
eligible with the reason, so the agent does not start work that cannot be verified.

**3. Get the task.** `create_improvement_goal` with the finding identifier returns the goal and the prompt. The prompt states
the problem, the evidence, the paths that may be written, what must not change, the acceptance criteria and the exact
validation command. Audit will not recommend this step until at least one run is stored. Calling it again for the same
finding returns the goal that already exists with `created: false`, so exploring the response costs nothing; pass
`createAnother` to cut a second goal deliberately.

**4. Make the change**, within the write scope. The scope is not advisory: it exists because a change that touched twenty
files cannot be attributed to a measured outcome.

**5. Verify.** Rerun the scenario, `compare_runs` against the baseline, then `validate_improvement_goal` with the comparison
identifier. The response reports the comparison verdict and each criterion as satisfied, refused or undecided.

**6. Report honestly.** An undecided criterion is not a pass. If the comparison reports insufficient evidence because the
sample is too small, run more repetitions instead of claiming an improvement.

## Doing the same thing from a shell

Everything above works with `--json`, which produces exactly one document on standard output, including on failure:

```bash
orchescope audit --json > audit.json
finding=$(python3 -c "
import json
findings = json.load(open('audit.json'))['data']['findings']
print(next(f['id'] for f in findings if f['goalReadiness']['eligible']))
")
orchescope goal create "$finding" --json > goal.json
orchescope goal show "$(python3 -c "import json;print(json.load(open('goal.json'))['data']['goal']['id'])")" --prompt
```

Exit codes are part of the interface: `0` success, `1` findings at or above a `--fail-on` threshold, `2` a caller mistake,
`3` refused by policy, `4` the audited system failed, `5` the environment is missing something, `130` interrupted.

`orchescope trace` is the exception, and it is the one a pipeline cares about: it exits with the status the traced
command exited with, the way `timeout` and `env` do, so a step that already reads statuses keeps reading them. The
codes above still apply where Orchescope itself is what failed, which is every path that ends before a target runs.
`--json` reports the target's own status as `data.exitCode` for a caller that needs the two kept apart.

A traced command keeps standard output to itself. The run report is a diagnostic and goes to standard error beside the
privileges notice, so `orchescope trace -- generate > out.json` writes the file the target wrote. Under `--json` the
document owns standard output and the target's output moves to standard error rather than being dropped.

The document has the same four keys whatever happened, and `error` is present exactly when `ok` is false:

| Key | On success | On failure |
| --- | --- | --- |
| `ok` | `true` | `false` |
| `command` | the command that ran, for example `audit` or `goal create` | the same |
| `version` | the Orchescope version | the same |
| `data` | the result | `null` |
| `error` | absent | `code`, `category`, `message`, and `detail` |

A refusal carries `error.detail.setting` when policy denied it, so a script can name the setting to change without parsing
prose.

`export` is the one command whose output is an artifact rather than a report about one. Without `--json` it writes the
artifact to standard output or to `--out`. With `--json` it writes the usual document, naming the format, the byte count
and the file, and carrying the artifact in `data.content` only when no file was given. An agent should pass `--out` so a
large document never fills the conversation.

## What the agent should not do

- **Do not edit the goal.** Its `prohibitedChanges` name this explicitly. A validation the implementer can redefine is not a
  validation.
- **Do not edit a stored baseline**, benchmark or comparison.
- **Do not weaken an evaluator** or delete an assertion to make a scenario pass.
- **Do not turn off a policy setting, a permission check or redaction** to get something to run.
- **Do not report an undecided criterion as satisfied.** Say what could not be judged and why.

## Cost and permission

Read only tools touch nothing. The three executing tools respect `execution.allowProcessSpawn` and are refused with the setting
named when it is off, which lets you give an agent the analysis without giving it the ability to run your system.

Nothing in Orchescope calls a model, so an agent asking it for an audit is not spending anything at a provider. The rules
are deterministic over the evidence supplied. Raw audit documents can still differ in volatile timings and display IDs.
