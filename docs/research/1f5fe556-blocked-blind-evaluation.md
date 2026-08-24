# Blocked blind evaluation of candidate 1f5fe556

## Decision

The independently selected blind evaluation of `orchescope@0.9.1` at
`1f5fe556db5abd762c43c5d35f0b15e15f7df6df` completed, and the release decision was **BLOCK**. The evaluated package
archive had SHA-256 `1b11e56ba50ece693191d4f1b03e5da9cb2e7492be71b037990af0db7d3b45bc`, size 580,639 bytes,
package version `0.9.1`, and seven archive paths. This artifact was not published, tagged, pushed or attached to a
release.

## Independent selection, exclusion and role validation

The evaluator selected the targets after the candidate was frozen and without using either target during
implementation:

- Positive: `https://github.com/manohar42/AI-Article-Writer` at
  `a81ea1e0a4d8b3724fc9acd8f01ec71aee5ccea6`, tree
  `02ac1a02092c300bb85d43d1e0383a12455cb154`. Its MIT `LICENSE` has SHA-256
  `4938b79666d260b2fa82054b029acbcce953d1cd2fbe89ce02bda39a279920bd`.
- Negative: `https://github.com/riigait/claude-usage` at
  `e459579fc1020b75d43f80dbbf0d6b822f9c0a22`, tree
  `2adb0ae1ac0a975263df343105eeaad8fc9a4f5e`. Its MIT `LICENSE` has SHA-256
  `face49146cdd2a94cee94680f566ff47c3920d8169d8a2c71e6306a6fa648428`.

The positive is a bounded fixed-DAG agentic application. A user supplies an article topic, and nested LangGraph
workflows perform model-mediated research, search, retrieval, planning, generation and output actions. This is not a
claim that it implements a ReAct loop or model-selected arbitrary tools. The negative is a fixed-purpose usage checker
and widget: its executable source opens one usage page, makes a fixed same-origin usage request, saves the response and
displays it. Declarative `SKILL.md` guidance for an external host does not make that executable an agent system.

The positive tree holds 9 tracked files and 93,668 tracked bytes. The negative holds 19 tracked files and 41,845
tracked bytes. Both repositories and their source lineages are permanently ineligible as blind holdouts at any
revision. A corrected candidate requires a different unseen positive and negative pair.

## Blocking prompt population

The positive imports `ChatPromptTemplate` from `langchain_core.prompts`, constructs templates through
`from_template(...)` and `from_messages(...)`, and invokes them with runtime values. Exact source establishes prompts
whose inputs include the user's topic, search result text, retrieved page content, outline context, section title and
section constraints.

The frozen package nevertheless reported the prompt adapter as not applicable with zero files inspected, components
and relations. It reported the prompt-injection rule as not applicable because no runtime-interpolated prompt was
discovered, and emitted no prompt-specific refusal. The rest of the positive graph remained visible: 28 components,
38 relations, one informational observability finding, zero strengths and incomplete topology. Treating an exact,
supported prompt population as absent made the rule result misleading, so publication was blocked.

The negative was correctly reported as not an agent system: zero components, relations, findings, strengths and
metrics, with all three supported Python files parsed. Correct negative polarity cannot waive a false negative on the
positive.

## Runtime and evidence boundary

No target runtime was executed. The positive requires real OpenAI and SerpAPI credentials and performs model, search,
embedding and page-download operations; it supplies no bounded offline substitute. The negative requires Playwright,
Chromium and a user's authenticated Claude.ai browser profile to read private usage data. No credentials, browser
session, endpoint, provider response, user task or substitute execution was invented.

The evaluator invoked only the binary installed from the frozen archive. Installation, version, bundle digest,
doctor output, three static audits per target, colour and `NO_COLOR` terminal documents, JSON, Mermaid and SARIF
exports, source-span review, target cleanliness and semantic repeatability were preserved. The completed-results
manifest covered 1,320 files and had SHA-256
`ce0d413edb83da4a4a6896d716e970662de953f0df530d2687cc69146902bdd7`. No credential value, private path, runtime
identifier or trace identifier is included in this public record.

## Generalized correction and regression disposition

The correction does not match generic prompt-like class names. Runtime identity begins with exact import provenance
for the supported LangChain prompt exports, including direct, renamed and namespace imports. A foreign module, local
lookalike, type-only import, shadow or rebound symbol cannot acquire that identity. A future framework needs its own
explicit provenance declaration or an honest unsupported boundary; a class named `ChatPromptTemplate`, `AgentXYZ` or
similar is never sufficient by itself.

After provenance is established, shared source facts retain adjacent strings, transparent parentheses, fluent calls,
lexical owners, parameter defaults and calls of returned callables. A reusable callable-reachability analysis follows
bounded aliases, parameters, defaults and nested calls while accounting for source order, mutations, escapes,
decorators, destructuring and branch joins. Complete branch settlement is a bounded proof over the whole branch-path
tree; incomplete or overly complex paths preserve prior bindings or become unknown rather than being cleared by one
convenient branch.

The prompt reader now emits six exact prompt components with semantic template, system and human channels. It settles
one human invocation as runtime-interpolated and one system message as static. It emits no `uses_prompt` relation
because the consuming graph components are not source-settled, and instead records five source-located prompt-use
refusals. The corrected positive measures 34 components and the same 38 relations; the prompt adapter contributes six
components, zero relations and three inspected files.

Independent adversarial review replayed direct and renamed imports, foreign lookalikes, partial application,
constructor forms, callable aliases and wrappers, nested mutation, setters, closure/default captures, returned calls,
decorators, destructuring, source-order changes and nested conditional joins. The generalized correction passed that
review before corpus promotion.

The positive is pinned in the regression corpus at its exact revision. Its acceptance contract fixes the six prompt
identities, semantic roles, settled interpolation details, zero `uses_prompt` relations, five exact refusals, adapter
population, graph population and finding polarity. All 59 semantic assertions held when the expectation was recorded
and when it was checked independently. The negative adds no distinct precision invariant and is not added to the
corpus.

This correction and regression do not change the frozen decision. Publication remains prohibited until a newly frozen
candidate passes the complete release gates and a new independently selected unseen positive and negative pair.
