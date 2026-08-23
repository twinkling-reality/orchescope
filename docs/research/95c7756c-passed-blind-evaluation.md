# Passed blind evaluation at candidate 95c7756c

This record preserves one completed application of the
[pre-release blind evaluation protocol](../guides/pre-release-blind-evaluation.md). It is a release decision about one
frozen artifact and one independently selected pair, not evidence about another artifact or another repository.

## Frozen boundary and selection

- Candidate revision: `95c7756c3aebf40b728c5ee5f476aab3633a6b85`
- Installed package: `orchescope@0.9.0`
- Evaluated tarball SHA-256: `59a98bbdb7c7e25565e2aa60ebce6da6bcbea8053a30ea5ff818ea89136a5533`
- Positive: `https://github.com/box-community/openai-agents-sdk-v2-demo` at
  `daf811baacd06f6829d904f596b1125a5817be04`
- Positive licence: MIT `LICENSE`, SHA-256
  `930aade4d7252572313cc91189846780eb4f06be9085a7de8976ebb48be5aa08`
- Negative: `https://github.com/a2aproject/A2A` at
  `16ba52690519bf55b9388e34d4db356efa88aa51`
- Negative licence: Apache-2.0 `LICENSE`, SHA-256
  `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`

The independent evaluator did not implement the candidate. Selection occurred after the candidate was frozen. The
release owner granted exclusion clearance after a zero-match search of the public tree, corpus, fixtures, evaluation
records, and Git history. The positive remote tree held 9 blobs and 153,089 bytes; the negative held 133 blobs and
2,174,518 bytes. Neither remote tree enumeration was truncated.

## Positive measurement

The positive is an implemented agent application: `main.py` imports `agents.Runner`, constructs `SandboxAgent`, and
calls `Runner.run_streamed`. The installed artifact did not detect an agent system (`agentSystemDetected: false`) and
reported zero components and zero relations. That zero was visible rather than promoted into an absence claim:

- `adapter:openai-agents` reported `completed`, zero components, zero relations, one inspected Python file;
- `adapter:effects` reported `completed`, zero components, zero relations, and zero inspected files;
- coverage reported `agents is imported here and its adapter found nothing` with the bounded
  `adapter_found_nothing` explanation;
- topology was `incomplete`, with one source-located `adapter_input` refusal at `main.py:16` stating that
  `adapter:openai-agents` supplied no inspected topology population for the applicable input;
- the report exported zero evidence records, zero findings, and zero strengths; and
- a repeated same-input semantic projection was identical.

The scan discovered 2 source files, parsed its 1 supported Python file without a skip, and covered 10,944 source
bytes. The completed-zero outcome does not establish that the repository declares no agent. It establishes that the
applicable reader remained visible, explained its silence, kept topology incomplete, and supplied no absence-based
positive claim.

## Negative measurement

The A2A repository reported zero components, zero relations, zero findings, and zero strengths. The scan discovered
34 source files and parsed all 5 files in supported languages without a skip, covering 17,499 source bytes. Its own
documentation states that A2A is an agent-to-agent communication protocol rather than an agent development kit. The
result introduced no false component or absence claim.

This negative contributes no precision invariant distinct from the corpus's existing agent-adjacent controls, so it
is not a corpus entry. Its use in this evaluation still makes its repository and source lineage permanently
ineligible as a blind holdout.

## Runtime boundary

No runtime audit was executed. `OPENAI_API_KEY`, `BOX_DEVELOPER_TOKEN`, and `BOX_FOLDER_ID` were absent. The documented
application downloads external Box content, permits model-directed shell commands and package installation, and moves
Box files. No bounded external account or folder population and no authorization for those effects was supplied.
Credentials, side effects, and a substitute execution were not guessed.

## Integrity and decision

- The installed checksum and reported `0.9.0` version matched the frozen artifact.
- `doctor` reported zero warnings against both target checkouts.
- Audit JSON, exported report JSON, SARIF, and Mermaid documents parsed successfully.
- Forced-colour output contained ANSI escapes, while `NO_COLOR` output contained none.
- Both target worktrees retained their pinned revisions and clean status through measurement.
- Same-input semantic projections were identical on repeat.
- The completed-results hash manifest verified without a mismatch.

The release decision was **PASS**. The positive's completed-zero applicable adapter stayed visible with an
`adapter_found_nothing` gap and incomplete-topology refusal, and neither target produced a wrong identity,
absence-based strength, unsupported citation, hidden silence, over-scoped metric, or repeatability blocker.

## Regression and ineligibility

The positive becomes a full-static regression at the evaluated revision. That regression preserves the exact
completed-zero evidence boundary; it does not claim `SandboxAgent` support and cannot replace an unseen holdout.

Both selected repositories and their source lineages are permanently ineligible as blind holdouts at any revision.
Candidate `95c7756c3aebf40b728c5ee5f476aab3633a6b85` cleared this blind gate only for the evaluated `0.9.0` artifact and
the selected pair. A subsequent artifact needs its own frozen candidate boundary and a different unseen positive and
negative pair under the public protocol.
