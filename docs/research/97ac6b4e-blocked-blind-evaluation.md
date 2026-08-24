# Blocked blind evaluation of candidate 97ac6b4e

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`97ac6b4e48023ad6fa2e465a702abe4422a16a7d` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `91c71ad094f13bf6f28f7a3798db43289c3e126bcc5d1b975ef4a87459956f39`, size 562,659 bytes,
package version `0.9.1`, and seven archive paths. The release summary recorded `published: false`. This artifact was not
published, tagged, pushed or attached to a release.

## Independent selection, exclusion and role validation

The evaluator selected the targets without inspecting the corrected Orchescope source, corpus, fixtures, research
records, development history or implementation discussion:

- Positive: `https://github.com/Arfazrll/Browser-Automation-Agent` at
  `d139df4234b8953e82fa4b635e07e68387ffa1a3`, tree
  `826ea16411044f70b27f43540abc7cfed6de444e`. Its MIT `LICENSE` has SHA-256
  `7d0a21635bfbdf0b1b29ba95056f018e42d5de912446a430e58f4e94b09db039`.
- Negative: `https://github.com/frankchiu-dev/claude-codex-usage-dashboard` at
  `96fcb981327bc86b15c8b3fb9be3fd8836eb2a7f`, tree
  `eab98788971df14d168baa500639e5598b366849`. Its MIT `LICENSE` has SHA-256
  `33a6ae5ff8d5d779db2776f5293e6922b07064bdd42274aaef9da21c3fe34bf0`.

The evaluator paused before acquisition. A separate release owner searched the current and ignored trees, corpus
cache, fixtures, research records, prior evaluation records, implementation paths, refs, commit messages, every
historical path, all reachable commits and all reachable Git objects. Neither coordinate, revision, tree, distinctive
phrase nor nonempty source blob appeared in the exposed population. Repository metadata identified both as public,
bounded, pre-freeze repositories without a fork, source, template or mirror parent. The release owner granted
exclusion clearance before acquisition.

Pinned-source review then established the roles. Browser-Automation-Agent is a packaged CLI application: its command
accepts a task, calls a local runner, builds `browser_use.Agent` with a model client and awaits `agent.run` with the
configured step ceiling. The usage dashboard reads local Claude Code and Codex usage state, cache and status-line data
and renders a local dashboard. Its bounded optional status-line fanout does not construct, download or drive an agent.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Blocking silent agent population

The positive imports `Agent` from `browser_use`, constructs it in a local `build_agent` factory, assigns that factory
result in the runner and awaits `agent.run`. The CLI, factory, assigned result and run call are all present in the
supported Python population. The scan parsed all 13 supported Python files, skipped none, truncated nothing and
reported no unsupported input.

The frozen package nevertheless reported `agentSystemDetected: false`, zero components, zero relations, zero evidence,
zero findings and zero strengths. Its agent and model readers all reported not applicable, and its unsupported list was
empty. The terminal document said that the scan found zero parts and no agent system, then recommended adding a
manifest. Three complete semantic projections were identical, so the silence was repeatable.

This is publication-blocking misleading silence. A fully parsed, source-proven `browser_use.Agent` construction and
candidate run call cannot support the public absence claim without an explicit bounded refusal. The negative was
reported correctly as having no agent system, but that cannot waive the positive false negative.

No target runtime was executed after the static block. The positive requires a provider credential and a browser task,
and it supplies no bounded fake or offline path. No credential, task, browser action, provider response or substitute
execution was invented.

## Evidence integrity

The evaluator invoked only the binary installed from the frozen archive. Installation, version, binary digest and
doctor checks; static JSON and human audits; forced-colour and `NO_COLOR` documents; JSON, Mermaid and SARIF exports;
source-span reviews; three repeat semantic projections per target; target status and revisions; source hashes;
environment names with values redacted; commands; standard output; standard error; and exit statuses were preserved.
Both targets retained their pinned revisions and clean tracked state.

The completed-results manifest covered 351 evidence files and verified without mismatch. Its checksum sidecar had
SHA-256 `54d342dbe0ca4900cbf01e84f397de503eed83682df6bbd147b5f96b65b364c7`. The preserved results,
checkouts and isolated installation were made read-only. No credential value, private path, runtime identifier or trace
identifier is included in this public record.

## Regression disposition

The positive is pinned as a source-cited regression at its evaluated revision. The distinct invariant requires exact
`browser_use.Agent` import provenance, a stable direct or returned-factory source identity, construction evidence, and
either an exact `agent.run` boundary or a source-located refusal when an intervening operation prevents settlement.
Direct,
renamed and namespace imports remain supported; foreign, local or shadowed lookalikes do not acquire identity, and a
rebound, captured, destructured or otherwise unsettled receiver does not lend a run boundary.
No exact model, provider, task value, browser action graph or universal step ceiling is inferred from runtime
configuration.

The negative contributes no additional precision invariant and is not added to the corpus. Neither this regression
work nor a corrected scan changes the frozen decision or can clear the blocked candidate.
