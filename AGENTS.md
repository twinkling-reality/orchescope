# AGENTS.md

Instructions for any agent or contributor changing this repository. Keep this file short: the architecture lives in
`docs/architecture/`, the plan lives in `PLANS.md`.

## What this repository is

Orchescope discovers, maps, audits, benchmarks and resilience tests agentic systems. Its defensible core is the join
between what a repository **declares** and what a run **exercises**, and the loop that turns a finding into a bounded
goal whose outcome is verified by rerunning the same scenario. If a change does not serve that join or that loop, it
probably belongs in a different tool.

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
pnpm test                    # unit and integration tests
pnpm test:e2e                # end to end tests against the bundled demonstration
pnpm test:ui                 # Playwright browser tests
pnpm build                   # bundle the publishable artifact into apps/cli/dist
pnpm build:web               # build the browser workspace into apps/web/dist
pnpm package                 # pack a tarball, checksum it, install it and run it
pnpm orchescope <args>    # run the CLI from source
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
edges         apps/cli, packages/mcp, packages/report-server, apps/web, apps/demo
```

Rules the tooling enforces:

- `packages/schema` imports nothing from the workspace and no Node builtin.
- `packages/domain` imports only `packages/schema` and `node:crypto`.
- Core packages never import `persistence`, `workspace`, `usecases`, `mcp` or `report-server`.
- No package imports an app.
- `apps/web` may import only `@orchescope/schema`, and only for types.
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
- A new rule needs a test that fires it and a test that proves it stays quiet without evidence.
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
- Loopback only for every server, with a Host allow list, an Origin check and a capability token.
- A refusal names the setting that would grant the action. Nothing downgrades silently to a weaker mode.
- Do not claim that prompt injection, agent execution or chaos testing is safe.

## Interface expectations

- The CLI is a product surface. Animate only while work runs, show a determinate count only when the total is known,
  never invent a percentage, respect `NO_COLOR`, and never print a secret.
- Every JSON output is a single document shaped `{ ok, command, version, data }`.
- The browser workspace renders untrusted text as text. No `innerHTML`, no inline styles with dynamic content.
- A control the current configuration cannot perform is disabled with its reason shown, or absent. Never a button
  that fails when pressed.
- Every displayed number carries its basis: observed, discovered, inferred, estimated, simulated or model
  interpreted.

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

## Validation before you claim a change works

1. `pnpm verify` from a clean checkout.
2. For anything touching discovery: run `pnpm --silent orchescope --cwd apps/demo audit --json` and read the coverage
   block, not just the exit code.
3. For anything touching runtime: `pnpm orchescope trace -- node apps/demo/src/main.ts` and confirm spans arrived.
4. For anything touching the report: `pnpm build:web` then `pnpm orchescope audit --serve` and look at the page.
5. State what you ran and what it printed. Do not report a check as passing unless it ran.
