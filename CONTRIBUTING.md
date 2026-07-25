# Contributing

Thanks for looking. This document is what a change has to satisfy; [AGENTS.md](AGENTS.md) is the short version for anyone,
human or agent, editing the repository.

## Set up

```
pnpm install
```

Node.js 24 or newer and pnpm 10. There is no build step for development: Node runs the TypeScript directly, so a change is
live the moment you save it.

```
pnpm verify
```

That runs `check`, `test` and `test:e2e`, and it is the gate. Run it before you open a pull request, from a clean checkout.

For the browser tests, install the browser once:

```
pnpm exec playwright install chromium
pnpm test:ui
```

## The commands

| Command | What it does |
| --- | --- |
| `pnpm check` | Format, lint, types, dependency direction, unused code, schema drift |
| `pnpm test` | Unit and integration tests |
| `pnpm test:e2e` | The command line contract and the improvement loop, through the real binary |
| `pnpm test:ui` | The browser workspace, in Chromium, against a real served report |
| `pnpm test:coverage` | Coverage, for looking at rather than for a threshold |
| `pnpm orchescope -- <args>` | Run the CLI from source |
| `pnpm demo` | Run the demonstration agent system |
| `pnpm build` | Bundle the publishable artifact |
| `pnpm package` | Pack a tarball, checksum it, install it and audit a project with it |
| `pnpm run licenses:check` | Verify every runtime dependency is redistributable |
| `pnpm sbom` | Generate a CycloneDX inventory |

## What a change needs

**A reason in the commit message.** One line, imperative, describing the change rather than the file. No attribution
trailers.

**Tests that would fail without it.** A new rule needs a test that fires it and a test that proves it stays quiet without
evidence. A new adapter needs a fixture repository and a test asserting the components, the relations and the evidence, which
is what makes the support claim in the README true. A bug fix needs the test that reproduces the bug.

**Evidence in the pull request.** State what you ran and what it printed. For anything touching discovery, run
`pnpm orchescope -- --cwd apps/demo audit --json` and read the coverage block, not just the exit code. For anything touching
the report, run `pnpm build:web` and look at the page.

**Honesty about what you did not do.** A pull request that says "tests pass" when `test:ui` was not run is worse than one
that says the browser tests were not run.

## Boundaries the tooling enforces

`pnpm deps` fails when a dependency points outward. The layering is in
[docs/architecture/module-boundaries.md](docs/architecture/module-boundaries.md); the short version is that `schema` depends
on nothing, `domain` depends only on `schema` and `node:crypto`, core packages never reach storage or assembly, no package
imports an app, and `apps/web` sees only schema types.

`pnpm unused` fails on an unused file, export or dependency. Dead code is not left behind for later.

Biome enforces formatting, complexity and function length. The complexity ceiling is 25 for most code and 30 in the modules
whose job is recognising external shapes (source analysis, wire format decoding, framework adapters), where a flat sequence of
branches is the clearest expression. The function length ceiling is 120 lines, off for test files and browser components,
where one function is one suite or one render.

## Conventions worth knowing before you write code

- **Name a file for the responsibility it holds.** No `utils`, `helpers`, `common`, `misc`, `shared` or `manager` anywhere.
- **Relative imports carry the `.ts` extension.** Node runs the TypeScript directly, so the extension is real.
- **`import type` for types.** `verbatimModuleSyntax` is on.
- **Comments explain rationale, security properties, invariants, protocol requirements and external constraints.** They do
  not narrate what the next line does, and they never contain a temporal marker: no "for now", "currently", "later", "once
  we", "after migration", "old approach".
- **No `TODO`, `FIXME`, `HACK` or `XXX`.** Either do it or open an issue.
- **No em dash characters** anywhere in the repository, in code, comments, documentation or commit messages.
- **Time and randomness come from arguments**, never from the platform: `fixedClock` and `seededRng` in tests.
- **Waits are event driven.** A test that sleeps to fix flakiness will be rejected.

## Security expectations

Treat repository source, configuration, trace data, model output, tool output and imported artifacts as untrusted.

- Never spawn a shell. `spawn` and `execFile` take an argument array, always.
- Resolve and normalise every path against the repository root before touching it. A textual prefix check is not enough.
- Every string that leaves the process passes through `@orchescope/redaction`.
- Loopback only for every server, with a Host allow list, Fetch metadata checks and a capability token.
- A refusal names the setting that would grant the action. Nothing downgrades silently.
- Never claim that prompt injection, agent execution or chaos testing is safe.

See [SECURITY.md](SECURITY.md) for reporting a vulnerability, and
[docs/security/threat-model.md](docs/security/threat-model.md) for the reasoning.

## What gets rejected

- A finding without evidence, or a metric without a sample size.
- Presenting an inference as an observation, or an estimate as a measurement.
- A claim of statistical significance.
- A retry around a side effecting operation whose idempotency has not been established.
- An unbounded queue, retry, concurrency or output.
- A placeholder implementation, a speculative adapter for an unreleased framework, or an interface with one implementation
  added "for extensibility".
- Support claimed in the README for something no test exercises.
- A dependency added without a reason in the pull request, or a native dependency without a measured benefit.

## Reporting a bug

Include the version (`orchescope --version`), the platform, the exact command, what you expected, what happened, and the
output of `orchescope doctor`. A repository or a scenario that reproduces it is the most useful thing you can attach; if the
repository is private, `orchescope audit --json` with the findings removed usually shows enough.

## Proposing a feature

Open an issue that answers three questions: what question about an agent system does this let someone answer, what evidence
would the answer be based on, and how would a reader know the answer is wrong. A feature that cannot answer the third one
usually belongs in a different tool. [docs/product/non-goals.md](docs/product/non-goals.md) lists the boundaries that are
deliberate.

## Licence

Contributions are accepted under the Apache License 2.0, the same licence as the project. There is no contributor licence
agreement.
