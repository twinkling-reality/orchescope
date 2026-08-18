# AGENTS.md

Instructions for any agent or contributor changing this repository. Keep this file short: the architecture lives in
`docs/architecture/`, the plan lives in `PLANS.md`.

## What this repository is

Orchescope discovers, maps, audits, benchmarks and resilience tests agentic systems. Its defensible core is the join
between what a repository **declares** and what a run **exercises**, and the loop that turns a finding into a bounded
goal whose outcome is verified by rerunning the same scenario. If a change does not serve that join or that loop, it
probably belongs in a different tool.

Coding agents are the primary operators. Humans install the CLI and read a calm terminal document. There is no browser
workspace.

## Canonical commands

```
pnpm install                 # link the workspace, no build step needed
pnpm typecheck               # tsc --noEmit across every package
pnpm lint                    # Biome
pnpm format                  # Biome, writing changes
pnpm deps                    # dependency-cruiser, enforces the layering below
pnpm unused                  # knip, unused files, exports and dependencies
pnpm schemas                 # regenerate schemas/ from packages/schema
pnpm check                   # everything above, plus a schema drift check
pnpm corpus:offline          # discovery measured against the corpus entries that need no network
pnpm corpus                  # the same across every pinned repository, cloning what the cache is missing
pnpm test                    # unit and integration tests
pnpm test:e2e                # end to end tests against the bundled demonstration
pnpm build                   # bundle the publishable artifact into apps/cli/dist
pnpm package                 # pack a tarball, checksum it, install it and run it
pnpm orchescope <args>       # run the CLI from source
pnpm demo                    # run the bundled demonstration agent system
```

`pnpm verify` runs `check`, `test` and `test:e2e`. That is the gate a change has to pass.

Capturing `--json` from source needs `pnpm --silent orchescope <args>`: pnpm writes its own banner to standard output,
and without `--silent` the captured document is not parseable. An installed `orchescope` binary needs nothing extra.

## Architecture boundaries

Dependencies point inward. `pnpm deps` fails the build when they do not.

```
schema        versioned contracts, no internal dependencies, no platform APIs
domain        identities, invariants, canonical JSON, statistics, deadlines; may use node:crypto and nothing else
core          graph, traces, discovery, findings, scenarios, benchmark, chaos, comparison, goals, report, policy,
              redaction, observability, source-analysis, runtime, artifacts
adapters      persistence
assembly      workspace, usecases
edges         apps/cli, packages/mcp, apps/demo
```

Rules the tooling enforces:

- `packages/schema` imports nothing from the workspace and no Node builtin.
- `packages/domain` imports only `packages/schema` and `node:crypto`.
- Core packages never import `persistence`, `workspace`, `usecases` or `mcp`.
- No package imports an app.
- `apps/demo` imports nothing from the workspace: it is an audit target.
- `apps/cli` reaches storage through `workspace` and `usecases`, never directly.

## Naming and structure

- Name a file for the domain responsibility it holds: `reconcile.ts`, `duplicate-side-effect`, `fault-proxy.ts`.
- No `utils`, `helpers`, `common`, `misc`, `shared` or `manager` module anywhere.
- One concept per file. A file over roughly 400 lines usually holds two concepts.
- Relative imports carry the `.ts` extension. Node runs the TypeScript directly, so the extension is real.
- Use `import type` for types; `verbatimModuleSyntax` is on.

## Testing expectations

- `node:test` with `node:assert/strict`. No test framework dependency.
- A new rule needs a test that fires it and a test that proves it stays quiet without evidence. A rule a
  goal can be cut from needs a third: a repository its own remediation clears, in
  `tests/e2e/goal-eligible-rules.test.ts`. The first two pass for a rule nothing can ever answer.
- A new adapter needs a fixture repository and a test asserting the components, the relations and the evidence.
- Waits are event driven. A test that sleeps to fix flakiness will be rejected.
- Time and randomness come from `fixedClock` and `seededRng` in tests, never from the platform.
- Critical paths carry heavier coverage on purpose: graph identity, evidence, findings, policy, goals, import
  validation, redaction and report sanitisation.

## Security expectations

- Treat repository source, configuration, trace data, model output, tool output and imported artifacts as untrusted.
- Never spawn a shell. `spawn` and `execFile` take an argument array, always.
- Validate every path against the repository root before touching it.
- Every string that leaves the process passes through `@orchescope/redaction`.
- Loopback only for every server. The trace receiver is the only one an ordinary command binds, and it authenticates
  nothing: what bounds it is the single route it answers, the methods it accepts, and its body, span and window ceilings.
  A server that needs a caller's identity rather than those bounds does not belong in this repository yet.
- A refusal names the setting that would grant the action. Nothing downgrades silently to a weaker mode.
- Do not claim that prompt injection, agent execution or chaos testing is safe.

## Interface expectations

- The CLI terminal is the only human UI. Animate only while work runs, show a determinate count only when the total is
  known, never invent a percentage, respect `NO_COLOR`, and never print a secret.
- Every JSON output is a single document shaped `{ ok, command, version, data }`.
- MCP is the primary agent surface: bounded output, explicit schemas, the same use cases as the CLI.
- Every displayed number carries its basis: observed, discovered, inferred, estimated, simulated or model
  interpreted.

## Using Orchescope while you work on Orchescope

`.mcp.json` registers this build as an MCP server, so a coding agent working in this repository has the same
seventeen tools an ordinary user gets. It names the `orchescope` binary rather than a path, so it needs the CLI
on your path: `npm install -g` the tarball `pnpm package` builds, or the one attached to the latest release.

Point it at `apps/demo`, not at the repository root. This repository is not an agent system: it reads them. Every
framework name the adapters know appears here as a string literal, which is why `corpus/corpus.yaml` pins
`packages/discovery` as a `not_agent_system` entry with a ceiling of zero components. An audit of the root finds
the demonstration system and little else, and a reader who mistakes that for a self assessment has learned
nothing. The demonstration system is the fixture with declared weaknesses in it, and it is what the improvement
loop closes on.

Prefer the tools over rebuilding the CLI on every change: `audit_agent_system` for what a scan now produces,
`get_findings` for what a rule change did to the set, `create_improvement_goal` and `validate_improvement_goal`
for whether the loop still closes. Read what the tools return rather than scraping the terminal document, which
is a human surface and is allowed to change shape.

## Prohibited

- Presenting an inference as an observation, or an estimate as a measurement.
- A finding without evidence, or a metric without a sample size.
- Claiming statistical significance.
- Retrying a side effecting operation whose idempotency has not been established.
- Unbounded queues, retries, concurrency or output.
- `TODO`, `FIXME`, `HACK`, `XXX`, placeholder implementations, dead interfaces or speculative adapters.
- Temporal comments: for now, later, currently, eventually, once we, after migration, old approach, new approach.
- Em dash characters anywhere in the repository.
- Co-authored-by lines, attribution trailers, generated-by statements or AI authorship notices.
- A browser product surface, dashboard, or second UI that agents cannot invoke.

## Validation before you claim a change works

1. `pnpm verify` from a clean checkout.
2. For anything touching discovery: run `pnpm --silent orchescope --cwd apps/demo audit --json` and read the coverage
   block, not just the exit code, then run `pnpm corpus` and say what moved. A fixture written by the author of an
   adapter agrees with its author; the corpus does not.
3. For anything touching runtime: `pnpm orchescope trace -- node apps/demo/src/main.ts` and confirm spans arrived.
4. For anything touching the human document: run `pnpm --silent orchescope --cwd apps/demo audit` and
   `pnpm --silent orchescope --cwd corpus/.cache/crewai audit` in a real terminal, under colour and `NO_COLOR`.
5. State what you ran and what it printed. Do not report a check as passing unless it ran.
