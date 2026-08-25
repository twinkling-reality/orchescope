# Blocked blind evaluation of candidate f7019531

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`f7019531ef891fcee06f35d6bd362b934d255b0b` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `e20f972e70f03210c488d521ed1885f8cee97e4b42effaafcc148faaff6bea87`, size 590,847 bytes,
package version `0.9.1`, and seven archive paths. It was not published, tagged, pushed or attached to a release.

## Independent selection and source roles

The evaluator selected both targets from metadata after the candidate freeze and before acquiring either source tree:

- Positive: `https://github.com/darylalim/speechwriter-agent` at
  `96dabf2633be92929530e034f0d5d48646ef26c6`, tree `6f14a821724c9056cba139ee218d9357543daf57`.
  Its root MIT `LICENSE` has Git blob `42615e5a1f910ad333bc3bfec8782341c062cf35` and SHA-256
  `f4efdb2d00e7b040bc8fd1df8569bacf2f52652d47313230dcf8e8bd78a1df88`.
- Negative: `https://github.com/GrowBridge-LLC/praetor-security` at
  `88affb0b8d5cbc3ec7c023d15e9bf4f49a1cc912`, tree `01c9f0384d5957e8ab83bd4185e4fd9bae57c3d1`.
  Its root MIT `LICENSE` has Git blob `2f4b841041fd0e2b77573a8f2ceb3891e3faca61` and SHA-256
  `a43404aff9a01b0b2da9f5f25a925503dc7477505ec3c302cbcb8115f191f2a7`.

The release owner independently found zero matches for both coordinates, owners, names, repository identities,
revisions, trees, licence identities and source lineages across tracked and ignored development files, corpus inputs,
fixtures, evaluation records, refs, stashes, remotes and complete Git history before granting acquisition clearance.

Speechwriter Agent is an implemented goal-directed Deep Agents application. Its exact production source imports
`deepagents.create_deep_agent`, constructs a named speechwriter with a model, prompt, subagents, skills, backend,
permissions, store and checkpointer, and drives the returned graph through streaming CLI and web entry points. The
source tree contained 36 tracked files and 928,020 tracked blob bytes; its manifest SHA-256 was
`9d81b4331759d1109f619534dd04ce755130d67c125e2ba12f6fbb21211f3ebc`.

Praetor Security is a fixed-purpose passive security scanner. Its complete production path deterministically reads
source and lockfiles, invokes bounded static-analysis executables when configured, reduces their results and renders a
report. It does not construct or drive an agent, select tools or actions for a goal, or delegate that behavior to
downloaded code. The source tree contained 90 tracked files and 1,004,433 tracked blob bytes; its manifest SHA-256 was
`d74cea5af1e4ab0192f01a5a43337695f76f782e4e922c5356b4c5b4a961afbd`. The evaluator and release owner independently
verified both roles before package installation.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Blocking positive measurement

The installed artifact reported `agentSystemDetected: false` for Speechwriter Agent and the human document said
`No agent system was detected: no adapter here recognised one.` It emitted only two components and one relation, none
an agent identity. The exact pinned source at `src/speechwriter/agent.py:200-214` constructs
`create_deep_agent(...)`, names it `speechwriter`, and supplies its model, tools, prompt, subagents, skills, backend,
permissions, store and checkpointer. The CLI and web source drive the returned `bundle.agent.stream` value. A bounded
LangGraph refusal named imports but did not identify or refuse the exact Deep Agents construction or its invocation
boundary. The missing agent identity and unexplained exact framework population are publication-blocking misleading
silence.

The same graph also minted `entrypoint:_paginate`, `external_service:unresolved-host-_paginate`, a `calls_service`
relation and network write permission. At `src/speechwriter/memory.py:110-133`, `fetch` is a typed callback parameter;
callers supply local `BaseStore` list and search lambdas. Python has no browser `fetch` global and the source contains
no HTTP request or host at that call. This is a false effect identity whose unsupported graph propagated into JSON,
Mermaid and SARIF output and supported a network finding.

All 18 supported files from 22 discovered inputs parsed without a skip or truncation. The static graph contained two
components and one relation, one informational finding and zero strengths. The repeat audit's semantic projection
matched the initial projection exactly; the stable result repeated the defects rather than curing them.

No target runtime was executed. The positive has no Orchescope scenario, requires `ANTHROPIC_API_KEY` for an agent
turn, may use `TAVILY_API_KEY`, reaches paid external services and writes workspace and memory state. Credentials,
external responses and a substitute execution were not guessed. Measurement stopped immediately after the positive
static blockers, so the negative was not scanned and no result is claimed for it.

Both target worktrees and the candidate remained at their exact clean revisions. The completed-results manifest covered
136 files, verified without a mismatch, and had SHA-256
`822acede87de479f48f5cbfd7c7161447ae1454f3fc43d78e6a72dd58cfe0d9d`.

## Generalized correction and regression disposition

The framework correction is an exact `deepagents.create_deep_agent` source reader. Direct, renamed and namespace
runtime imports retain provenance; foreign, local, type-only, shadowed and rebound lookalikes do not. A stable declared
or assigned call identity produces the agent, while literal model and direct local tool populations produce only their
source-supported relations. Computed model, prompt, subagent, skill, permission and invocation populations become
source-located refusals. No generic `Agent`, graph-shaped name or target-specific repository string participates in the
decision.

The effect correction treats bare `fetch` as the JavaScript browser global only in JavaScript source and only when the
exact lexical position has no local binding. Python callables and JavaScript parameters, imports or declarations that
shadow the spelling do not acquire an HTTP identity. The unshadowed JavaScript global retains its supported behavior.

After the generalized correction, the exact positive yields only `agent:speechwriter`, no external-service component,
no `_paginate` identity and no service relation. The Deep Agents adapter completes with one exact applicable import and
one agent, and the effects adapter completes with zero components and zero relations. The graph remains honestly
incomplete with ten source-located refusals for computed populations and unsupported direct invocation settlement.

The positive is pinned at its exact revision with 51 reviewed semantic assertions over its agent identity, metadata,
evidence, exact adapter applicability, absent false effect shapes, refusal population, findings and incomplete topology.
The unmeasured negative contributes no reviewed output invariant and is not added to the corpus. These regressions cannot
clear the blind gate; the corrected candidate still needs a different unseen positive and negative pair.
