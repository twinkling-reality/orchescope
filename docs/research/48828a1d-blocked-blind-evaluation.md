# Blocked blind evaluation of candidate 48828a1d

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`48828a1d2f3d8aa479124987a04eb8d672fc63a3` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `61603179f78bca84aa21e71d4060aa3b8a500b4a372784be86fe441c62f8ac2b`, size 542,863 bytes,
package version `0.9.1`, and seven archive paths. The release summary recorded `published: false`. This artifact was not
published, tagged, pushed or attached to a release.

## Independent selection and exclusion

The evaluator selected the targets without inspecting the corrected Orchescope source, corpus, fixtures, research
records, development history or implementation discussion:

- Positive: `https://github.com/Roozbeh-Sdtz/jarvis-home-commander` at
  `740d23097b6525feb1ef8de740a18e16598db8de`. Its MIT `LICENSE` has SHA-256
  `b9b7a0bd8894a4c5124e1509a6f849c44e38ddda1b182e3bab6dbdc201dfed29`.
- Negative: `https://github.com/shiki-yusuke/agent-cost` at
  `d170ea301ed0c46351749214bd299e75ae8a7786`. Its MIT `LICENSE` has SHA-256
  `6aa9203532be4d8d905482f69e8bba71f4948cce00a620ccd9eab10950e87a93`.

The evaluator paused before acquisition. A separate release owner searched the current tree, ignored corpus cache,
fixtures, research records, implementation paths, ref names, commit messages, every historical path, all 313 reachable
commits, and all 6,313 reachable Git objects. Neither proposed coordinate, revision, name or nonempty source lineage
appeared. Repository metadata identified both as public bounded MIT repositories without a fork, source or template
parent. The release owner granted exclusion clearance before the evaluator acquired either target.

Both repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A corrected
candidate requires a different unseen positive and negative pair.

## Positive source and blocking claims

The positive is a voice-first home-control agent application. Its repository activates the Codex desktop application,
opens a project chat and voice session, supplies an operational agent persona, and exposes household device operations.
That agent runtime is external to the Python source readers in this build. The installed package reported the unsupported
boundary explicitly and did not claim that no agent implementation exists, so non-detection was not a blocker.

Two material reliability findings were blocking. One said a Telegram send is retried after an ambiguous failure. The
cited consumer commits the update offset before handling the message and sending its receipt. If the send fails after a
server-side effect, the next poll uses the advanced offset and does not reissue the same receipt. The discovered generic
wrapper and provider POST edges do not establish that a specific non-idempotent send is the operation repeated by the
loop.

The other finding grouped OAuth device authorization polling and bounded device pairing into a definite duplicate-effect
claim. Authorization polling repeats only while the server explicitly reports pending and returns on success. Pairing
repeats only after an explicit non-success response, returns on success, and does not catch a request failure. Their
effect semantics were recorded as unknown. A loop and a repeated request do not by themselves prove that an operation
is reissued after an ambiguous successful effect, and uncertainty cannot support a definite duplicate impact.

Both findings also said the change was verified by a deterministic chaos run and prescribed
`scenarios/support-desk.yaml`. The target contained no scenario file; the report carried zero scenarios and zero chaos
reports; and doctor stated that no scenario was defined. A demo fixture path is not evidence about this repository.
Unsupported causal claims, definite impacts derived from unknown semantics, and an invented verification relation each
independently block publication.

## Negative result and evidence integrity

The negative remained correctly classified as an offline accounting utility rather than an agent system. It reads local
coding-agent usage logs and SQLite state, normalizes token facts and estimates cost. The package reported three parts,
two relations, one informational runtime-coverage finding, zero strengths, and an explicit incomplete runtime boundary.
It made no broader absence claim.

The evaluator invoked only the binary installed from the frozen archive. Installation, version and doctor checks;
static JSON and human audits; colour and `NO_COLOR` documents; JSON, Mermaid and SARIF exports; source-span reviews;
repeat semantic projections; repository status; revisions; source hashes; environment-name capture; commands; standard
output; standard error; and exit statuses were preserved. Both repeat semantic projections were byte-identical. Forced
colour contained ANSI escapes and `NO_COLOR` contained none. Both checkouts retained their pinned revisions and clean
tracked state. A completed-results manifest covered 264 evidence files, verified without mismatch, and had SHA-256
`dab33c4f106103182512ad235a186b55c335faee4bc0f4979718f08b1be599a8`.

No runtime or chaos audit was executed. A representative positive run requires a real Codex voice session,
Accessibility permission, paired HomeKit state, household devices, LAN addresses and credentials. The repository
supplies no bounded substitute path. No credential, real household effect, guessed secret or fake production path was
used, and no runtime claim is made.

## Regression disposition

The generalized invariant is that a duplicate-effect finding requires evidence that the same known non-idempotent call
is reissued after an ambiguous failure. A pause establishes backoff only after retry causality is known; it does not turn
polling, explicit non-success handling or a durable consumer loop into a retry. A generic wrapper cannot borrow an
aggregate provider effect class, and an unknown effect remains uncertain. Goal readiness and experiments require a
repository scenario that targets the operation under an ambiguous-result fault and checks duplicate effects; absent
that evidence, no scenario command or prior-verification claim is emitted.

The positive is pinned as a regression input at its evaluated revision. Generalized fixtures retain the negative
offset-before-send, OAuth-polling and return-on-success pairing shapes, plus a true positive that catches an ambiguous
failure and reissues a known non-idempotent operation. The negative contributes no distinct precision invariant and is
not duplicated in the corpus. Neither regression work nor a corrected scan changes this frozen decision or can clear
the blocked candidate.
