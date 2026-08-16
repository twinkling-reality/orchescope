# Changelog

Notable changes per released version. Nothing here is generated; a release is a person writing down what moved and why.

## 0.2.0

Released 2026-08-16 from npm as `orchescope@0.2.0`.

This release answers a field report from two sessions against real systems: one deep run through the full loop against a
private TypeScript monorepo, one sweep of `audit --json` across thirty six repositories. Its finding was that the tool
systematically treated *absence of measurement* as *measurement of absence*, and that its pattern matching rules were
being fed generated code. Across those thirty six repositories the retry rules produced no true positive at all, and both
findings marked goal eligible in the deep run were false.

Almost everything below exists because of that report.

### A traced run now produces evidence

Before this release, `orchescope trace` set three OpenTelemetry environment variables and nothing else. They are inert
unless the target process already loads an OpenTelemetry SDK, and essentially no Node project does, so every traced run
in the field report collected zero spans and every audit stayed inventory.

Orchescope now loads its own instrumentation into a traced Node process through `NODE_OPTIONS=--import`. It records
outbound requests and names each one by what it did: a call to a published model endpoint becomes a model call with the
provider, the model and the token counts; a JSON-RPC document becomes a protocol call naming the tool it executed,
including a tool call a target makes to a server it started over standard input; anything else is a request to a service.

The shim is deliberately small and deliberately inert. It refuses any endpoint that is not loopback, stands down
entirely if the target already runs OpenTelemetry, registers no signal handler, never writes to the target's output, and
swallows its own failures. It also reports what it declined to patch, so a run that collected nothing can say why rather
than looking like a target that made no calls.

**This puts Orchescope code inside a process you own.** It is on by default because that is the difference between what
the product claims and what it delivers, and it is a setting, `runtime.autoInstrument`, because you may not want it.

### Findings that were confidently wrong

**Nothing derived from a run that measured nothing.** A recorded run is evidence that a command executed, not that
anything was observed. Runs are now split into those that produced at least one span and those that produced none, and
the vocabulary lives in the domain layer so every rule inherits it rather than remembering it. An empty run no longer
reaches reconciliation, no claim can carry `basis: observed` with nothing observed, and an acceptance criterion facing
absent data reports `undecided` instead of banking a zero it never earned.

**A loop is a retry only when something in it says so.** A loop containing a `try` and an `await` is also the shape of
per item iteration with per item error isolation, and of a one shot helper whose only `try` guards a parse. A re-attempt
now has to be stated by the code: a wait before the next pass, or a header that counts attempts.

**A rule does not assert an absence it never checked.** Before reporting a missing idempotency key or attempt ceiling,
discovery follows the call one frame into the sink and looks for a deduplicating statement, a key derivation or a
declared bound. What it saw is recorded and the rules decline rather than accuse, and they say how many they left alone.

**Generated code is set aside by what it is, not where it lives.** A name based exclusion list will always lose the race
against `.docs-out`, `packages/extension/media/assets` and whatever the next bundler writes. Detection is by content, and
its thresholds were measured against this repository's own source, its pinned corpus and six published minified bundles.

**A consequential operation is a finding only where a model can reach it.** The risk this rule names is a model deciding
on its own to invoke something consequential. Firing on every consequential operation instead raised four React
components issuing `DELETE` behind a user's click, a continuous integration script posting to GitHub, and a sandbox event
sink. Operations it declines are counted and named rather than dropped silently.

### Detection accuracy

- **A coding agent's configuration is not your system.** A `.mcp.json` listing one server was enough to report a two
  hundred and twenty component Cloudflare Workers application as a detected agent system holding no agent, no tool and no
  model, and then to raise a finding against that repository because nothing in it could reach the server. Servers are
  now recorded as implemented, consumed, or developer tooling, and the last of those is neither evidence of an agent
  system nor part of its topology. It still appears in the graph, because it is a true fact about the repository.
- **A model call is recognised by the host it is sent to.** A system that calls a provider through `fetch` rather than
  through its published package has no import to find, and one project in the sweep ran thirteen MCP servers and reached
  OpenAI by posting to `api.openai.com` with no `openai` entry in its manifest. The audit described a fifty seven
  component agent system containing no model. The host table is now shared between static discovery and the runtime shim,
  so a repository is recognised the same way whether the evidence comes from its source or from its traffic.
- **A host the source never writes down is named for its call site.** Every request whose address is built at run time
  used to be one component called `unresolved-host`: in one project, eleven call sites across nine files in three
  packages, merged into a single node carrying one effect class that could be right for at most one of them.
- **An adapter that read nothing says so.** The `adapter_blind_spot` kind is now `adapter_found_nothing`, because the
  reason beside it has always named two causes and declined to choose between them. The old name is still accepted for
  reading and is never written.

### The agent surface

- **`create_improvement_goal` returns the goal a finding already has.** Six calls with the same finding identifier
  produced six identical goals, which an agent exploring the response shape does without meaning to. The match is on the
  rule as well as the identifier, since a finding identifier is renumbered whenever the set of findings changes. Pass
  `createAnother` to cut a second goal deliberately.
- **Every answer now arrives in the text block as well as the structured payload.** `get_findings` used to return
  `2 of 2 findings.` and nothing else as its text content, so a client that renders text showed its reader nothing and a
  model that did not know to look reported that it had found two findings and nothing about them. The text mirrors the
  same bounded page, one line per record.

### Workspace and honesty about scope

- **State is excluded from git from the first run of any command.** The nested `.gitignore` used to be written only by
  `init`, and the quickstart tells you to run `audit` first. Across the sweep that left thirty of thirty three git
  repositories showing an untracked `.orchescope`, ninety seven megabytes in total.
- **`init` says when a rule in your repository will bury the configuration.** It prints that
  `.orchescope/config.json` is meant to be committed, and git does not consult a `.gitignore` inside a directory an
  ancestor rule already excluded. The fix it prints was measured against git rather than reasoned about, because the one
  that first suggests itself does not work: git will not re-include a file whose parent directory is excluded. `doctor`
  reports the same thing.
- **The command allow list is described as the guardrail it is.** It checks `argv[0]` only, so `orchescope trace --
  seorak` is refused while `orchescope trace -- npx seorak` runs, and `npm run`, `uv run` and `node -e` walk past it the
  same way. Checking further would close nothing, because a runner's argument is any command.
- **A traced command runs with your full ambient privileges.** It writes the files it always writes, binds the ports it
  always binds and reaches the network it always reaches. Orchescope adds environment variables and, for a Node target,
  loads its own instrumentation. It takes nothing away and it is not a sandbox. This is now said in the documentation and
  once in the terminal as the process starts.

### Upgrading

**Configuration moves to `schemaVersion` 3.** `allowProcessSpawn` and `allowedCommands` are now `execution.allowProcessSpawn`
and `execution.allowedCommands`. They decide whether Orchescope starts a process and which one, and they used to sit
beside the settings that constrain Orchescope itself, where a reader taking the block as a whole concluded that tracing
was sandboxed.

A file written before the split is read forward and `doctor` reports that it was, so nothing breaks on upgrade. A file
naming the same setting in **both** places is refused rather than resolved: picking a winner would discard one of the two
values you wrote, and the direction that gets discarded is the one that denies something.

**Two severity changes will move your finding counts.**

- `observability-coverage` on a repository with no run recorded drops from medium to info. It fired in twenty three of
  twenty three repositories that had a component, which is a finding carrying no information: it says you have not run
  the next step yet, and the loop already says that and routes to it. A run that was recorded and produced no spans stays
  at medium, because something was attempted and the instrumentation did not land. If you gate continuous integration on
  `audit --fail-on medium`, a repository nobody has traced will now pass where it used to fail.
- `side-effect-approval-boundary` fires only where an agent, a tool or an MCP server reaches the operation.

**Component counts will move.** A request whose address is built at run time is now one component per call site rather
than one per repository, and a call to a known model provider becomes a model and a provider rather than an anonymous
external service.

### Provenance

This version was published from a laptop with `npm publish --no-provenance`, so **it carries no attestation**.

What stands in its place is that the artifact is reproducible. `pnpm package` from this repository builds a tarball
byte identical to the one on the registry, which was checked by downloading the published one and comparing:

```
sha256  a65b91582690dd470942b95c4c2fdf124609d1007d72507ac9ea4f7f4da30b64
```

That is a weaker guarantee than a registry attestation and it is worth naming as such. It says the bytes match this
source; it does not say who published them.

### Verification

`pnpm verify` green at 782 unit and 103 end to end tests. `pnpm corpus` matched across thirteen pinned repositories, with
every expectation that moved traced to a call site read by hand. The published artifact was installed from the registry
into a clean prefix and audited a real TypeScript and Python project, which is the check that matters, because the
parsers resolve a native binding and a WebAssembly grammar relative to their own package directories.

## 0.1.0

First published release.
