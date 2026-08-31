# Passed blind evaluation at candidate 8741bc8b

This record preserves one completed application of the
[pre-release blind evaluation protocol](../guides/pre-release-blind-evaluation.md). It is a release decision about one
frozen artifact and one independently selected pair, not evidence about another artifact or repository.

## Frozen boundary and independent selection

- Candidate revision: `8741bc8b7d820d29a3a083875d8b87056f249bc0`, tree
  `ba9ef0eac074002efb5e16b2cd124a3bd3e9c727`
- Installed package: `orchescope@0.10.0`
- Evaluated tarball: `release/orchescope-0.10.0.tgz`, 619,487 bytes and seven files
- Evaluated tarball SHA-256: `041420b8a0a4e7762d26f92977c85694c7309aab86e7ef4029de97890cbe813f`
- Positive: `https://github.com/senseirandystl/trip-planner-ai-agent` at
  `ef29922019ad005bbaf74d2a76053b7ecb3a44c7`, tree `89ca8093a1b5302f14295e5f434443fc1d68f2e9`
- Positive licence: root MIT `LICENSE`, Git blob `4842561636f1a9751a4edb17a5a00c88f63e3e99`,
  content SHA-256 `7752a6a93d75903e92ef3d37901f6b77f47c158a89c878668e4aeb65d54740c7`
- Negative: `https://github.com/0xelitesystem/agent-trace-viewer` at
  `677478a73755ffbe2a9f1dea35645afda00d394c`, tree `9a71fbb6a290366db958aaf83c6ffae946c819d0`
- Negative licence: root MIT `LICENSE`, Git blob `c184bc07eec9bf9e38b36c3a8712a904b32afa36`,
  content SHA-256 `d19cd9fd264768c6777971a70e0169839675140d2abae4614b18dd93abd7bd03`

The evaluator did not implement the candidate. Selection began only after the candidate and package were frozen, and
stopped before installing or running Orchescope. Searches of hidden and ignored content, working-tree paths, full
history, diffs, commit messages, historical paths, refs and reflogs returned zero occurrences of the selected URLs,
names, aliases, revisions and root revisions. Neither lineage occurred in the 3,578 normalized repository names or in
the durable corpus and prior-evaluation records. Every selected or inspected lineage from an earlier evaluation was
excluded, and every rejected intermediate lineage was retired before this pair was accepted.

After acquisition, the evaluator established both roles from source and the release owner independently verified them
before measurement. The positive contains 21 tracked files and 75,315 Git-blob bytes. Its OpenAI Responses loop gives
the model two concrete OpenStreetMap and Wikivoyage functions, executes selected calls, returns
`function_call_output` observations, and enforces `max_steps=8`. The Streamlit application passes the user's trip goal
to that loop. It is an implemented agent application.

The negative contains four tracked files and 25,373 Git-blob bytes. Its only executable file is a dependency-free
401-line HTML document. It parses completed traces, calculates and renders their recorded metrics, and stores a display
theme. It does not construct or drive an agent, invoke a model, select or execute an action, launch a process, or load
executable code from the network. It is agent-adjacent trace tooling rather than an agent system.

Both checkouts were detached at the exact revisions, had no submodules, and remained clean through selection and
measurement.

## Package and measurement integrity

`shasum -a 256 release/orchescope-0.10.0.tgz` produced the evaluated archive digest above. The evaluator installed that
archive into a clean global prefix. `npm install --global --prefix ...` added eight packages and exited zero;
`npm ls --global --depth=0` listed `orchescope@0.10.0`, and the installed binary printed version `0.10.0`.

Installed-binary `orchescope doctor --json` exited zero with `ok: true`, zero warnings, nine checks `ok`, and two
checks `not_applicable`. Both supported parsers loaded. The product checkout and both target checkouts were clean
before and after measurement.

The evidence ledger contains 80 files. `shasum -a 256 -c measurement/SHA256SUMS.txt` verified every entry, and the
ledger file itself has SHA-256 `e6f7a5daabfcea8e5e06c6c52eaa6fb6937e439a73f33426bac242972708738c`.

## Positive measurement

The installed tarball's `orchescope --cwd <positive> audit --json` command exited zero and produced one valid JSON
document with `agentSystemDetected: false`. The sample was 21 tracked paths, 16 discovered source files, 14 supported
and parsed Python files, zero skipped files, and 65,178 parsed bytes.

The report contained three static-only components and one relation:

- `provider:openai`, cited to the exact `OpenAI` import and construction in `src/agent.py`;
- `entrypoint:request_json`, cited to the smallest named callable that owns the external request;
- `external_service:unresolved-host-request_json`, whose dynamic host, unknown side effect and conservative network
  write permission agree with `requests.request(method, url, ...)`; and
- `calls_service:f117123767194e94`, which preserves the source-declared bounded retry, unknown idempotency and unknown
  effect.

The model SDK adapter completed with one component. The effects adapter completed with two components and two
pre-merge relations; the final graph retained one relation. Evidence coverage was 6/6 with zero omissions. The report
contained one information finding, `observability-coverage`, supported by the complete zero-run population, and zero
strengths or component metrics.

The independently verified hand-written agent loop was not claimed as an agent component. The report instead marked
topology `incomplete` with two unresolved boundaries: one source-located raw-client refusal at `src/agent.py:9` and one
explicit effects-population refusal. It emitted no absence strength and qualified the terminal result as no adapter
having recognised an agent system. That is the protocol's permitted honest refusal, not an unsupported claim that the
application source is non-agentic.

## Negative measurement

The installed tarball's equivalent audit exited zero with `agentSystemDetected: false`. The sample was four tracked
paths, zero supported or parsed source files, zero skipped files and zero parsed bytes. It contained zero components,
relations, findings, strengths, metrics and evidence records. All 18 adapters were explicitly `not_applicable`.

This agrees with the independently verified role and makes no broader claim about source the scanner does not support.
The terminal document states that nothing reported as a problem is not equivalent to nothing being wrong.

## Terminal output, repeatability and runtime boundary

The evaluator ran both human reports with forced colour and with `NO_COLOR=1`. The positive forced-colour document
contained six ANSI escapes and the negative contained four; both `NO_COLOR` documents contained zero. Stripping ANSI
from each forced-colour document produced byte-identical text to its `NO_COLOR` counterpart.

The evaluator repeated the scans in reverse target order. After deleting only timestamps, generated scan/report/graph
identifiers and measured adapter durations, both positive exports had SHA-256
`8544f65db1b2e622090be33e0c458d917dfbfb0385709a8b258f954ee60b6b40`, and both negative exports had SHA-256
`c614b56122cbd0e911a5ad0325fc3b51f67179b7e5977506a11ff7b6c7b4b51b`. The finding, three component identities and
one edge identity were unchanged; the negative remained empty.

Source establishes a real bounded positive runtime path from the application goal through `TripPlannerAgent.plan` and
the model/tool loop. No target runtime was executed because `OPENAI_API_KEY` and the checked Streamlit secret were
absent. Starting the server without driving the goal action would not exercise the agent. Credentials, model output,
external side effects and substitute execution were not guessed or fabricated.

## Decision and permanent use

Every emitted identity and material citation matched the pinned source. No unresolved boundary became an absence
strength, no semantic identity changed across the reversed-order repeat, every evidence reference resolved, and every
number above names the command or report population that produced it. The release decision was **PASS**.

The positive is promoted into `corpus/corpus.yaml` as the exact provider, external-effect, retry and honest topology
refusal measured here. The negative is promoted as a distinct zero-output precision ceiling for an inert trace viewer.
Both selected repositories and their source lineages are permanently ineligible as blind holdouts at any revision. A
product change after this freeze requires a new candidate and a different unseen positive and negative pair.
