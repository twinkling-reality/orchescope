# Mapping an agent system as agent systems proliferate

The declared half of Orchescope's join is produced by thirteen hand written per framework readers. The
observed half is produced by 2,491 lines that carry one framework identifier in total. That asymmetry is
the question: one more framework means one more reader, and the observation side already scales by
convention because telemetry has a standard and source does not.

The plan below is staged, and each stage states what measures it and what would falsify it. Every number
was re-derived against the corpus at `5466223`, and the command that produced it is beside it, so a reader
who distrusts a figure can run it rather than take it.

Three decisions follow from it, proposed separately so each could be accepted or refused on its own
evidence. All three are accepted, each on a measurement pre-registered before it was run:

- [ADR 0003](adr/0003-fact-model-breadth.md), the fact model is the breadth lever and a fact records only
  what the syntax says.
- [ADR 0004](adr/0004-provenance-not-confidence.md), recognition is widened by provenance and never by
  lowering a confidence band.
- [ADR 0005](adr/0005-corpus-invariants.md), the corpus gate holds invariants that `--record` cannot
  rewrite.

## What the measurement changed about the question

Four things this repository records about itself are close to true and are not exactly true, and each one
moves the answer.

**The corpus reports seven adapter gaps. One is an adapter gap.** ADR 0002's second measurement is that
every gap the corpus reports is an adapter form in a language already parsed, and it treats all seven as
work items. Read one by one they are three different things:

| entry | reported gap | what it is |
| --- | --- | --- |
| `crewai-examples`, `crewai-examples-exercised` | `agents` | **false.** Three `main.py` files write `from agents import ...` and each has a sibling `agents.py`. No checkout declares the `agents` distribution. |
| `crewai` | `mcp` | correct refusal. Twenty client side imports; the only `FastMCP(` sites are inside a test fixture string literal. |
| `open-deep-research`, `open-deep-research-exercised` | `mcp` | correct refusal. `from mcp import McpError` is an error class. |
| `open-agent-platform` | `@langchain/core` | correct refusal, and pinned as one. Message and document types. |
| `open-agent-platform` | `@modelcontextprotocol/sdk` | **real.** `new Client({name, version})` in `apps/web/src/hooks/use-mcp.tsx`, roughly thirty lines of adapter. |

```
ls corpus/.cache/crewai-examples/crews/instagram_post/     # agents.py sits beside main.py
grep -rn "^from agents import" corpus/.cache/crewai-examples --include='*.py'
python3 -c "import json;print(json.load(open('corpus/expected/crewai-examples.json'))['adapters']['adapter:openai-agents'])"
```

That last command reads `filesInspected: 3, status: completed`, which are the three `main.py` files. So a
pinned entry reports a framework gap that does not exist, and `adapter:openai-agents` is recorded as
having run on a repository that uses none of it.

This makes ADR 0002's evidence stronger, not weaker: what limits breadth is one adapter form, not seven.
It also names the fact that is missing, and the fact is the same one every convention on the declared side
needs first. `ImportFact.module` is a string. Nothing in the fact model says whether `agents` is a
distribution or this repository's own file. `matching.ts:59-73` guesses from path shape, and
`discover.ts:146-156`, which writes the coverage claim, does not even do that.

**The containment boundary is `packages/discovery`, not `packages/discovery/src/adapters`.** Framework
names in live code outside `adapters/`:

```
grep -rn "langgraph\|crewai\|pydantic\|vercel\|tenacity" packages/discovery/src/*.ts | grep -vE ": *\*|: */\*|: *//"
```

Fifteen lines across `graph-node-route.ts` (four, matching the LangGraph distribution) and
`declared-retry.ts` (eight, naming tenacity). Both arrived as extractions from an adapter, and what
leaked out is in both cases a pattern no convention expresses. That is the empirical signal about which
knowledge is irreducible, and it agrees with the classification below.

**Confidence is read for severity and is not read for identity.** Three call sites decide this:

```
sed -n '443,449p' packages/discovery/src/discover.ts   # agentSystemDetected: kind and audited population, no threshold
grep -n "confidence" packages/graph/src/reconcile.ts   # two hits, both the literal 0.95 written onto an output
grep -n "mergeConfidence" packages/graph/src/merge.ts  # Math.max
```

`MIN_CONFIDENCE_BY_SEVERITY` in `packages/domain/src/severity.ts:42` does cap a finding's severity by its
confidence, so the band is not decorative everywhere. It is decorative in the two places that decide what
a component is and whether a repository is an agent system. Every one of the four recorded confident wrong
answers was an identity or provenance error, and confidence does not attenuate identity.

**The corpus is already half the cost of a framework, and its expectations have no polarity.**

| what | measured |
| --- | --- |
| median committed diff for one framework, as the process now requires | **957 lines** |
| of which adapter | 262.5, **27.4%** |
| of which test and inline fixture | 215, 22.5% |
| of which corpus entry, expectation and run script | 476.5, **49.8%** |
| median follow up commits per adapter | 3 |
| of which fixed a confidently wrong answer | **7 of 17 across all adapters, median 1 each** |

The 957 is a reconstruction from medians rather than one observed diff, and it has to be, because no
adapter in this repository was ever introduced together with its own corpus entry. Its parts are each
measured: the three adapters added standalone committed 436, 483 and 532 lines with no corpus entry
between them (`288e823`, `51ce695`, `135de73`); a single static entry added alone cost 153 (`c0faf0a`);
the six exercised entries added alone have a median of 323.5. What the reconstruction does not include,
and what a fourteenth adapter also pays, is 6 lines added to every existing expectation: `135de73` added
exactly that to 13 of the 15 expectations that existed then.

The polarity problem is the sharper half. `corpus/expected/crewai-examples-exercised.json` records
`runtime.exercisedComponents: 0`, and zero is the fix: it is the refusal that replaced three joins to a
file the run never entered. The expectation stores it as a fact. Had the wrong join shipped, `--record`
would have printed `0 to 3` alongside an emptied `ambiguousNames`, which reads as more of the declared
graph exercised and fewer refusals, and a reviewer would have committed it. The only place the sentence
"zero is the fix" exists is `CHANGELOG.md`.

## The one thing every direction has to survive

`open-agent-platform` is pinned `not_agent_system` with a ceiling of 26 components, and its own prose
states the prediction: "a reader widened until an import or an SDK type is enough moves that zero and
this entry with it." It imports `@langchain/langgraph-sdk`, `@langchain/core` and
`@modelcontextprotocol/sdk`, and declares no graph, because the graphs it talks to are somewhere else.

Direction 1's two stated recognizers were implemented against `analyzeFileSet` and run on it. The
known distribution import fires 40 times: 24 of `@langchain/langgraph-sdk`, 14 of `@langchain/core`,
2 of `@modelcontextprotocol/sdk`. The known object keys recognizer fires twice, both on
`createAgent({name, description, config})`, which is a dialog configuring a remote deployment. Either one
produces a component in `AGENT_SYSTEM_KINDS`, which flips `agentSystemDetected` from `false` to `true`
and cascades through the gate at `prompts.ts:192` to a measured 26 components becoming 34.

A confidence band does not stop it, because `agentSystemDetected` does not read one. That is the whole
verdict on the most attractive direction, and it is a measurement rather than an argument.

```
node scripts/corpus.mjs --check open-agent-platform
grep -rhoE "from ['\"](@langchain/[a-z-]+|@modelcontextprotocol/[a-z-]+)" corpus/.cache/open-agent-platform \
  --include='*.ts' --include='*.tsx' | sed "s/from ['\"]//" | sort | uniq -c
sed -n '74,81p' corpus/.cache/open-agent-platform/apps/web/src/features/agents/components/create-edit-agent-dialogs/create-agent-dialog.tsx
sed -n '41,44p' corpus/.cache/open-agent-platform/apps/web/src/hooks/use-mcp.tsx
```

The entry matches its expectation today, at 26 components and 18 relations with both gaps reported. The
second command is the 40. The third is `createAgent(deploymentId, graphId, {name, description, config})`,
a form that calls a deployment this repository does not contain. The fourth is `new Client({name, version})`,
which is the one real adapter form among the seven reported gaps.

## Verdicts on the six directions

| direction | verdict | cost per framework | falsifier |
| --- | --- | --- | --- |
| 1. Convention on the declared side | **Reject as stated, adopt its inverse** | 957 to 791, and the band is inert | `open-agent-platform` flips to detected, measured |
| 2. A model that writes a reader | **Reject, adopt a deterministic scaffold** | 957 unchanged, follow ups unchanged | `crewai-examples-exercised` must read 0 exercised and 3 ambiguous |
| 3. Generated manifests | **Adopt the refutation, reject the breadth framing** | 0 per framework, ~571 lines of YAML per repository | an honest one component manifest still flips `open-agent-platform` |
| 4. Invert toward observation | **Reject, adopt one weaker form** | 957 to 1,036 | `open-deep-research-exercised` reads 7 of 26 components and 0 of 26 edges |
| 5. Reverse ADR 0002 | **Reject** | 691, repaid three times over on the first repository | `open-agent-platform` must stay undetected |
| 6. Do nothing structural | **Adopt the structure, reject the programme** | 1,119 to 994 at best | `crewai-examples` agent count 49, 73, 121 across three reader improvements |

The directions were judged against eight measurements over this repository, and the three findings that
decide them are the ones above. The two supporting numbers worth carrying:

- **Direction 4 had no evidence available in this measurement.** Across the eight exercised entries the run half reports 38
  components against the source half's 3,033, and 31 relations against 1,277. `byCodeLocation` is 0 on
  every one of them, and no span in the corpus carries a file path. 26 of the 31 findings a run adds are
  differences that require the declared set. `declared-not-exercised` names 1,114 components against
  `exercised-not-declared`'s 9. ADR 0007 records the later runtime source evidence that moves this specific
  bound without changing the evidence on which the direction was rejected as a replacement for discovery.
- **Direction 3 is already the policy.** `docs/guides/adapter-development.md:3-4` says start with the
  manifest. What was new is the word "verifies", and it was worth building: the engine accepted
  `definedIn: src/does-not-exist.rb`, and `fileHash` was written 0 of 17,115 times. Both are closed in
  Stage 3 below, and what a citation still cannot be checked against is named there.

## The claim

**The breadth ceiling is the fact model, and the correctness ceiling is provenance. Neither is the
adapter count.**

The declared side already has a convention layer. It is not a convention reader, it is the fact model,
and 42,077 lines sit on top of it knowing no framework name. The question is not whether conventions can
replace adapters. It is whether the boundary between the two is in the right place, and the measurement
says it is not, because the fact model is under powered rather than because the adapters are over powered.

### The fact model is not language neutral, and that is measurable in one program

`facts.ts:5-12` states the fact model is language neutral so that one adapter covers a framework in both
ecosystems. Run the same program through both analyzers:

```python
Agent(config=self.agents_config['lead_market_analyst'], verbose=True)
```
```typescript
new Agent({ config: agentsConfig['lead_market_analyst'], verbose: true })
```

TypeScript records `{"kind":"member","path":["agentsConfig","lead_market_analyst"]}`. Python records
`{"kind":"unknown","nodeType":"subscript"}`. The key is a fact in one language and a hole in the other,
and the framework whose own generator writes exactly that shape is Python.

The asymmetry is not one case:

| | JavaScript | Python |
| --- | --- | --- |
| `{kind:'arithmetic'}` produced across the corpus | 2,236 | **0** |
| `binary_operator` arguments dropped to `unknown` | not applicable | 2,798 |
| wait expressions readable as a backoff | 12 arithmetic of 1,103 | **0** of 1,100, 51 dropped |
| a module scope constant's name on a `TextFact` | `enclosing: 'SYSTEM'` | `enclosing: undefined` |
| adjacent string literals | one literal | two `TextFact`s, 1,830 sites |

`facts.ts:47-52` states the exact failure the `arithmetic` fact exists to prevent, `sleep(base * 2 ** attempt)`
read as `backoff: 'unknown'`. It was fixed in one language. Every Python retry in the corpus whose wait is
written as an expression still reports `unknown`.

### `subscript` is the largest hole, in every Python entry without exception

Unknown argument and assignment facts, by the most common `nodeType`:

| entry | args and assignments | unknown | top nodeType |
| --- | --- | --- | --- |
| `crewai-examples` | 1,203 | 227 (18.9%) | `subscript` 165 |
| `crewai` | 72,499 | 4,278 (5.9%) | `subscript` 1,027 |
| `open-deep-research` | 1,454 | 116 (8.0%) | `subscript` 48 |
| `pydantic-ai` | 112,484 | 5,543 (4.9%) | `subscript` 1,528 |
| `openai-agents-python` | 95,991 | 5,951 (6.2%) | `subscript` 1,918 |
| `langgraph` | 51,906 | 3,916 (7.5%) | `subscript` 1,403 |
| `gpt-researcher` | 10,606 | 641 (6.0%) | `subscript` 183 |

Seven of seven. Restricted to keyword arguments, where the fact model records an exact location and the
source can be read back, the share carrying a **string literal key**, which is the share a fact would
recover with no resolution at all, is 91% on `crewai-examples`, 88% on `open-deep-research`, 79% on
`gpt-researcher`, and 26% to 59% on the four framework checkouts, where most subscripts are generic type
parameters rather than data access.

### The model already resolves something the syntax leaves open

`javascript/analyze.ts:82-89` walks a `MemberExpression` without checking `computed`. Under oxc 0.141
`arr[i]` is a `MemberExpression` with `computed: true` and an `Identifier` property, so:

```
listeners[i](1)   ->   calleePath: ["listeners","i"]
```

which is indistinguishable from `listeners.i(1)`. The variable's name is recorded as a property name the
source never wrote. 2,854 such nodes exist in the corpus, 510 of them in positions the reducer reads. None
of the 187 callee cases collides with a name an adapter matches on, so this is latent rather
than live, and it is exactly the class the two prohibitions exist to prevent, sitting in the fact model
now. The `ComputedMemberExpression` branch immediately below at `:90-97` does require a literal and is
dead code: that node type occurs 0 times in 5,050 corpus files.

### What the two missing facts buy, measured end to end

`crewai create crew` writes this, and the CHANGELOG records that reading it is blocked on the parser:

```python
@CrewBase
class MarketingPostsCrew():
    agents_config = 'config/agents.yaml'
    @agent
    def lead_market_analyst(self) -> Agent:
        return Agent(config=self.agents_config['lead_market_analyst'], ...)
```

Every step of that chain is already a fact except two. The subscript key is dropped. The class attribute's
literal is dropped, because `DefinitionFact` carries an `initializer` only when the right hand side is a
call, and has no field for a value.

Both hold across the pinned repository:

```
grep -rhoE "agents_config\[\s*['\"][^'\"]+['\"]\s*\]" corpus/.cache/crewai-examples --include='*.py' | wc -l   # 49
grep -rnE "agents_config\[[^'\"]" corpus/.cache/crewai-examples --include='*.py'                              # none
for f in $(grep -rl "@CrewBase" corpus/.cache/crewai-examples --include='*.py'); do grep -qE "agents_config\s*=\s*['\"]" "$f" && echo "$f"; done | wc -l   # 19 of 19
```

49 of 49 subscripts carry a string literal key. 19 of 19 `@CrewBase` classes declare the document path as
a string literal. Simulated over the whole repository, re reading only those two values from source and
using real facts for everything else: **41 links resolve exactly, 8 decline, 0 attach wrongly.** That is a
simulation and not a re-run, which is exactly what Stage 1 exists to convert into a corpus number.

The substitute in the tree today is the enclosing method name, and the same simulation scores it **34
right, 10 wrong, 5 undecidable**. Two of the ten are `financial_agent` and `financial_analyst_agent` in
one file, both selecting the key `financial_analyst`: the heuristic splits one declared agent into two
and cannot tell that it did.

The eight declines are themselves facts rather than gaps. Five are `screenplay_writer.py`, where
`agents_config = yaml.safe_load(file)` leaves `initializer: ['yaml','safe_load']`, which is the syntactic
signal to refuse. Three are `email_filter_crew.py`, where the code selects three keys and the document at
the declared path declares one. That is a defect in that repository, and reporting it is a finding this
build cannot make.

### The discipline that makes this safe

The test is one sentence: **does the fact record what the syntax says, or does it resolve something the
syntax leaves open?** Applied:

| fact | verdict | why |
| --- | --- | --- |
| subscript with a **literal** key | safe | `x['k']` selects the entry literally named `k`. Nothing is open. |
| subscript with a **variable** key | dangerous, and shipped | this is the `arr[i]` defect above. Stays `unknown`. |
| a definition's literal **recorded** | safe | "the class body writes this literal to this name at this line" is unconditionally true. |
| a definition's literal **substituted** | dangerous | `@CrewBase` replaces the attribute before the method runs. Record every literal bound to the name, never one, and keep `initializer` beside it so a rebinding is visible. That is `aliasedFrom`'s stated rule at `facts.ts:113-124`. |
| Python arithmetic parity | safe | a flattening of operators and names, not an evaluation. Removes an asymmetry rather than adding a claim. |
| resolved import | conditional | safe if it is filesystem exact and refuses where more than one candidate exists. Dangerous the moment it follows a re-export or a path alias, because `matching.ts:108-115` would launder a wrong resolution from `heuristic` straight to `deterministic`. |
| intra module constant propagation | **rejected** | resolves what the syntax leaves open by construction. Measured payoff 16 of 337 unresolved request addresses, 4.7%, with 9 cases where more than one binding is a candidate. |

And the reason this lever is available at all: `ModuleFacts` lives in `packages/source-analysis`. It is
not in `packages/schema`, nothing under `schemas/` is generated from it, and no published document
version moves. It is the one place breadth can be bought without touching a contract.

## The stages

### Stage 1: two facts and one false gap, measured on `crewai-examples`

Small enough to prove or kill the claim. Three changes, all in `packages/source-analysis` and
`packages/discovery`, no schema version.

1. **A subscript or index fact carrying a literal key, in both languages.** Python gains a `subscript`
   case in `argumentFact`; the literal key read already exists at `python/analyze.ts:324-326`, gated on
   `os.environ`. JavaScript is a correction rather than an addition: gate the `MemberExpression` branch of
   `memberPath` on `computed !== true` unless the property is a literal, and delete the two dead branches.
   Estimated +14 Python, -6 JavaScript net.
2. **A literal value on a definition**, recording every literal bound to the name and keeping `initializer`
   beside it. JavaScript additionally needs a `PropertyDefinition` branch in the class walker, which
   records nothing today. Estimated +13 `facts.ts`, +8 Python, +21 JavaScript.
3. **The coverage claim stops naming a distribution the repository does not use.** Shipped, and the cause
   was three layers rather than the two stated here. `adaptersThatFoundNothing` at `discover.ts:146-156`
   built its import set with no local root filter, `localPythonRoots` recognised a package only at the
   repository root or under `src/` and therefore collected the **empty set** on `crewai-examples`, and
   `moduleMatches` consulted its local roots only for a dotted specifier, so the bare `agents` matched by
   exact equality before locality was reached. Repairing either of the first two alone would not have moved
   the entry. What replaced them is per file and filesystem exact: a module beside a script shadows a
   distribution of that name, and an `__init__.py` in the importing file's own directory is what says the
   file is a package member rather than a script. Locality by root still answers only for a submodule
   reference, because `openai-agents-python` defines `src/agents/` and imports `agents` meaning both its own
   package and the framework, and suppressing there would cost that entry every component it has.

**What measures it.** `node scripts/corpus.mjs --check crewai-examples crewai-examples-exercised
crewai open-deep-research`, against the committed expectations, then `--record` and read the diff.
Pre-registered:

| key | today | after |
| --- | --- | --- |
| `crewai-examples` `components.byKind.agent` | 121 | falls toward the ground truth of ~70; the config and source components for one agent become one |
| `crewai-examples` `foundNothing` | one entry naming `agents` | **empty** |
| `crewai-examples` `adapter:openai-agents.status` | `completed`, 3 files | `not_applicable`, 0 files |
| `crewai-examples-exercised` `runtime.exercisedComponents` | 0 | **must stay 0** |
| `crewai-examples-exercised` `runtime.ambiguousNames` | 3 | **must stay 3** |
| `crewai` `foundNothing` | one entry naming `mcp` | unchanged, it is a correct refusal |

**What falsifies it.** The last two rows. If `exercisedComponents` rises above 0 or `ambiguousNames`
empties, the change has made the two halves of the join agree by construction, which is the one thing this
join must never do, and it must be reverted rather than recorded. Those two rows are the whole discipline
in one assertion, and they are the reason this stage is worth running before anything else: a fact that
records syntax cannot move them, and a fact that resolves something can.

Secondarily, if `crewai-examples` `components.byKind.agent` does not fall, the claim that the fact model
is the ceiling is wrong on the repository chosen to show it, and the rest of this document is unfunded.

**Cost per new framework.** Stage 1 does not reduce it and is not offered as reducing it. It deletes the
enclosing name fallback in `crewai.ts:419-423` and roughly 49 lines of comment explaining why the join is
unavailable, and it stops one adapter producing two components for one agent. Book it as correctness.

### Stage 2: invariants that `--record` cannot rewrite

The corpus is 49.8% of the diff for a framework and `--record` overwrites every leaf of an expectation,
`agentSystemDetected` included: flipping `corpus/expected/flask.json` to `true` by hand and recording that
entry writes it straight back to `false`. What no recording can silence is the claim, because the claim is
read from `corpus.yaml` rather than from the expectation, by `claimDifference` at
`scripts/corpus/comparison.mjs:57` and again out of band by `tests/e2e/corpus.test.ts:52-65`. So one claim
per entry is held somewhere `--record` does not write, and the other 2,468 of the 2,495 leaves across 27
entries are recorded numbers that a reviewer either reads or does not.

Three families, ranked by failures caught over lines maintained.

**A generated negative corpus.** Take the five `not_agent_system` entries and inject the shapes that have
fooled this build: a `.mcp.json` with one server, a root `agents.yaml` of hosts and ports, a
`deploy/agents.yaml` of account executives carrying a `role` and a `goal`, a `wrangler.toml`, an
`mcpServers` key. Assert the invariant rather than a number: no component of an agent system kind counts
toward detection, `agentSystemDetected` stays false, and each injected shape either declines or records as
`developer_tooling`. Roughly 200 lines and zero expectation files, because an injection table crossed with
the existing negatives is generated. Two of the four recorded failures were found this way already, by
hand, and the fixtures at `adapters.test.ts:514` and `:812` are what a generator would have written.
Adding a shape is one table row, and it applies to every negative at once, so this grows with the failure
log rather than with the reader count.

**A dependency property, checked on every entry with no expectation.** Stated correctly: *a component
attributed to an adapter whose declared packages the repository does not use must carry
`details.role: 'developer_tooling'` and must not count toward `agentSystemDetected`.* Measured over the
corpus once Stage 1 had landed, which is what the measurement was waiting for: 6,032 components are
attributed to a framework adapter, and the count the property asks for is **0 under `projectUses`, which
is the predicate `appliesTo` itself asks, and 1 under the stricter reading of a source import alone**.
That one is `mcp_server:gpt-researcher`, which declares `mcp>=1.9.1` in `requirements.txt` and imports it
nowhere, and carries `role: developer_tooling`. **Zero violations under either reading.** For six of the
eight package declaring adapters the property is true by construction, because `appliesTo` is
`projectUses`. The two exceptions are `crewai` and `mcp`, each of which ORs a configuration door into
`appliesTo`, and those two adapters produced both recorded detection failures. The property is a check on
exactly the two doors that have ever leaked, and it covers adapters that do not exist yet because the
adapter set is `DEFAULT_ADAPTERS` filtered by whether the adapter claims a package.

`dependencyEvidence` was to be wired while doing it, and it is deleted instead. It records that a manifest
declares a package, and a manifest declaration answers this question on 12 of the 27 entries: on 15 a
framework adapter's packages are used and named in no manifest this build reads, and 9 of those declare
nothing at all because `readManifests` reads the repository root and they are monorepos. `crewai-examples`
has no root manifest, answers `crewai` entirely by imports, and holds 18 of the 21 components declared only
by a configuration document, so the evidence would have fired on 1 of those 21.

**And on the pinned corpus that property has almost no population, which is why it is second rather than
first.** At most one component satisfies its antecedent across all twenty seven entries and none at all
under `projectUses`, so a gate holding it over the pinned entries alone asserts over an empty set. The
generated negatives are what give it a population: an injected `.mcp.json` in a repository depending on
express is a component attributed to `adapter:mcp` in a repository importing no MCP SDK, which is the
antecedent by construction, on every negative at once. The two families are one change, not two.

**Stated as a universal invariant the property is false, and the counterexample is a correct answer.** A
`crew.jsonc` injected into a repository depending on express declares the two agents it lists and reports
an agent system, none of it carrying `developer_tooling`. `crew.jsonc` is a name CrewAI owns outright, so
that answer is right. The table of shapes is therefore drawn along a narrower line than the property: the
names that belong to nobody.

**An anti circularity check between the halves.** *An observed relation exactly rederivable from a
declaration is a circular join, not a join.* This is built from per field trace provenance. Every observed
component records the attributes behind its kind, name and code location. Every observed relation records
the runtime trigger separately from the attributes naming its endpoints. Reconciliation refuses a declared
edge when its whole trigger is one of those endpoint attributes and no span field says the relation happened.
The same edge from real parent span nesting is retained. The check therefore asks the property rather than
consulting the named `REDERIVABLE_ATTRIBUTES` refusal table, which is gone.

**And two lists that should be derived rather than written.** `tests/e2e/corpus.test.ts:23` declares
`FRAMEWORK_ADAPTERS` as a hand written array of six, where `DEFAULT_ADAPTERS.filter(a => a.packages.length > 0)`
is eight; it omits `adapter:mcp` and `adapter:search-index`. Both happen to be covered, so nothing fails,
and this is the exact anti pattern that `goal-eligible-rules.test.ts` and `rule-input-producers.test.ts`
were written to replace, sitting inside the test that guards the corpus. The other is every `Evidence`
kind against something that writes it, which fails immediately on `dependency`.

**What measures it.** The generated negatives and the property check run over all 27 entries and pass or
fail with no expectation to maintain. **What falsifies it:** if the dependency property has more than one
exception on the corpus after Stage 1, it is not an invariant and must not be a gate.

**Cost per new framework.** This is the stage that moves it. The per adapter
coverage block is 2,160 of 3,939 expectation lines, 54.8%, and it grows as six lines times entries for
every adapter added. An invariant that holds on every entry replaces recorded leaves rather than adding
them.

### Stage 3: make the declared half pinnable, and make a manifest refutable

Stage 3 is conditional on Stage 1 and Stage 2, and it is where the two harder questions get answered.

**Declarations leaving the source.** The premise is already partly false: 104 corpus components are
declared only by a configuration document, and a component with only a `ConfigLocation` silently loses
`declaredInTest`, which is derived from source locations alone, and loses any module namespace, which is
what the `code_location` join rule reaches for. The generalisation is that a declared half is anything
pinnable by content hash, and the schema is closer than it looks: both `SourceLocation` and
`ConfigLocation` already carry an optional `fileHash`. It was written 0 times. **It is written now**, in the
graph builder, which is where every draft from thirteen adapters and the manifest reader meets: 29,965 of
29,965 locations across the nineteen entries the required corpus measures, against 0 before, and no
expectation moves because an expectation records counts and kinds rather than locations. The bundles grow
about 15%, which is `pydantic-ai` at 4,077 KB becoming 4,690 KB, because 6,933 locations over 284 distinct
files repeat each digest about twenty four times. Recording each file once is a published document change
and is worth deciding separately.

Ordered by what can still honestly be claimed:

| where the declaration lives | what can be claimed |
| --- | --- |
| a configuration document at the revision | everything, and it is read today |
| a document generated at build time | the same, if the generator's output is pinned by hash |
| a database row, a UI assembled configuration | nothing as a declaration. An exported dump pinned by hash is a declaration; the live row is not. |
| an agent generated at run time by another agent | nothing. This is an observation, and the honest output is the observed half with the declared half stated as unpinnable. |

The CrewAI case is the worked example, and both of its answers are uncomfortable and correct. With only the
packaged `agents.yaml` and role names, `crewai-examples-exercised` reports zero exercised components and
three ambiguous names, because the repository declares each role three times. A bounded instrumentation
integration now records the actual Python constructor frame, canonical repository URL and full revision on
the later span for that same `Agent` object. Those independent runtime facts select the three declarations
in the marketing crew and nothing else: 3 code-location joins, 0 name-only joins, 0 ambiguities and 0
missing source attributes. The earlier zero remains the right answer to the name-only question.

**A refutable manifest.** The manifest is already a first class input and already the documented first
step, so what is new here is only the verification. The engine today accepts
`definedIn: src/does-not-exist.rb, definedAtLine: 4242`, and this repository's own reference manifest
would fail the check that makes a manifest safe: 16 of 18 components cite line 1, and 4 of 18 cite a file
that does not contain the name. The checks a deterministic engine can run with no model:

- every `definedIn` resolves to a file inside the repository that exists at the pinned revision,
- every `definedAtLine` exists in that file,
- the cited location's text contains the component's `name` or its `runtimeName`,
- every edge endpoint names a component this document declares or another producer discovered,
- a `runtimeName` is a string a run could actually report, which is the rule `crewai.ts:74-79` already
  applies to an interpolated role,
- the file hash recorded at write time still matches, or the manifest is reported stale rather than read.

**Four of those are built and the rest are named.** A `definedIn` naming no file the scan walked, a line
beyond what the file is long enough to hold, a `runtimeName` carrying a placeholder, and an edge endpoint
naming nothing declared or discovered are all refuted, and a manifest failing any of them is a failed
adapter run naming each claim while what it got right is still read. Two are not built and the reason is the
same in both cases: checking that the cited line's text contains the name means opening the file, and an
adapter never opens one, and there is no field on the manifest for a hash recorded at write time. The
traversal now records every path it walked whatever the language, because `collectFiles` keeps only what a
parser reads and the manifest exists for exactly the languages it does not.

Manifest version 2 adds one schema-local refutation beside those repository checks: `details.for` must
agree with the component `kind`. A mismatch is reported and the invalid details do not reach the graph.

The location this build was inventing is also gone: a component with `definedIn` and no `definedAtLine`
recorded line 1, which is a claim no manifest makes, and that citation is refused rather than completed.

**This repository's own reference manifest failed the standard it documents, measured**: 16 of 18 cited line
1, and 4 of those cited a file that does not contain the component's name at all, `account-worker` and
`inventory-worker` naming `src/agents/workers.ts` where they are declared in `src/agents/definitions.ts`,
and `demo-small` and `demo-large` naming `src/model.ts` where they are named in `src/main.ts`. All 18 now
cite a line containing the name they declare, which is four errors the engine still cannot catch.

**The bound reproduced, and [ADR 0006](adr/0006-manifest-component-details.md) moved it on the field it
named.** The version 1 one component manifest for `open-agent-platform` still flips
`agentSystemDetected` from false to true at **26 components becoming 27**. Manifest version 2 adds the same
kind-specific `details` an adapter writes. Declaring that server with `role: consumed` leaves detection
false at 27 components while keeping one visible `mcp_server` in the graph. Changing only the role to
`implemented` makes detection true, and the version 1 document remains readable with its established true
meaning. A consumed server can therefore participate in a system another component establishes without
claiming that its consumer repository implements one.

**Cost per new framework versus per repository.** A manifest costs 0 per framework and roughly 571 lines
of hand written YAML per application repository, at the reference manifest's measured 7.0 lines per
entity. One adapter is cheaper than manifesting 1.68 median application repositories. So the manifest is
the honest escape hatch it is documented as, and it is not a path to breadth. The staged answer keeps it
as an escape hatch and makes it refutable.

### Multi repository: the boundary holds, and here is what moves it

`docs/product/non-goals.md` called this the boundary most likely to move and required a design for cross
repository identity first. The boundary has moved for source-qualified runtime federation, on the condition
that document named rather than from a workspace assertion.

A `ComponentIdentity` is `(kind, namespace, localName)`, where the namespace is a module path relative to
one root, a configuration path, or the literal `runtime` or `manifest`. Cross repository identity needs a
repository coordinate in front of that namespace, and three designs are possible:

1. **A workspace document** listing repositories and revisions, scanned separately and joined into one
   graph. Cheapest, and it makes identity the operator's assertion rather than a measurement, which means
   a reader cannot tell a wrong pairing from a right one.
2. **Identity by declared interface**, where a service is named by the address or contract it exposes.
   Falsifiable, because the address is read from source on both sides, and it is the shape
   `request-address.ts` already builds. It resolves 403 of 740 request calls today.
3. **Identity carried by the trace.** `vcs.*` attributes on a span name the repository and revision that
   emitted it, so the run says which repositories to scan. This is the only one where the pairing is an
   observation rather than an assertion, and it is falsifiable by scanning the named revision and checking
   the component is there.

Design 3 is accepted by ADR 0008. ADR 0007 proved its source primitive inside one repository:
`crewai-examples-exercised` reports 3 code-location joins from runtime-derived Python frames, repository
coordinate and full revision. The same run reports 0 name-only joins and keeps relation joins at 0. The
primitive therefore fires without turning a role into a location.

The other condition is now pinned as `openai-agents-js-filesystem-mcp`. The OpenAI Agents JavaScript
repository's own filesystem example launches `@modelcontextprotocol/server-filesystem` over stdio, and its
lock selects release 2026.1.14. The release tag in the independently versioned MCP Servers repository peels
to the exact second commit in the corpus definition. Both are MIT. Scanning only the published filesystem
package reports 1 implemented server, 14 tools and 14 `provides_tool` relations across 12 supported files.
The combined system is not inferred from compatibility: the client repository contains the program that
starts this server package and calls its tools.

**The condition fired.** The pinned exercise completes one real `read_text_file` call through the upstream
stdio program and records six spans from three services. The client request maps to
`examples/mcp/filesystem-example.ts:8` in the client revision. Its W3C child maps through the executed server
build's source map to `src/filesystem/index.ts:206` in the server revision. Separate scans retain 668 and 15
components. Three runtime components join by code location, and one observed `calls_tool` relation crosses
from the client repository's MCP server declaration to the server repository's tool declaration.

The operator list still only locates work. Federation qualifies an existing `ComponentId` with canonical
repository URL and full revision, and accepts a cross-repository relation only after both endpoints select
exactly one declaration and independent parent context establishes causality. A duplicate MCP client span
without source identity is refused and contributes nothing. Wrong revisions, dirty graphs, one-sided traces,
missing parent context and identical local identities in different repositories are held as negative tests.

**Both clauses moved without being collapsed.** Per-attribute provenance names repository, revision, file, line
and function separately on each accepted source identity. Coverage names `code.file.path`,
`orchescope.code.repository.path`, `vcs.repository.url.full` and `vcs.ref.head.revision` with observed
sample counts where another instrumentor omits them. Parent-span provenance separately names the causal input
for the relation. Neither evidence class can substitute for the other.

## The success metric

**Today, measured:** 957 lines committed per framework, or 1,119 including the six lines each new adapter
adds to every one of 27 expectations. Roughly 1,998 lines over the lifetime of an adapter, at a median of
3 follow up commits. **Median 1 of those fixes a confidently wrong answer.**

The line count per framework is the wrong target. Every direction that cuts it materially cuts it by
loosening identity or provenance, and each was measured to reproduce a failure this build has already
paid for. The two numbers that can be reduced without widening that class:

| metric | today | target | what shows it |
| --- | --- | --- | --- |
| confidently wrong fixes per adapter | median 1, 7 of 17 follow ups | **0** | the generated negatives and the dependency property fire before a release, not after a field report |
| corpus share of the diff for one framework | 476.5 of 957, **49.8%** | **below 30%** | invariants replace recorded leaves; the per adapter coverage block is 54.8% of expectation lines today |
| adapters asserting a `runtimeName` they invented | 1 of 8 | 0 | all four crewai confident wrong fixes were this; `langgraph`, `pydantic-ai` and `model-sdk` join by location or structure and produced zero |

That last row is the structural finding underneath everything else. The confidently wrong tax did not land
evenly. It landed entirely on the adapters that assert a name a run will report, and not at all on the
adapters that join by code location or by graph structure. A `runtimeName` sits in the reconciler's
strongest lookup after a code location, and a wrong one does not merely fail to match: it waits to match
something else. Facts that make a name readable from syntax, rather than guessable from a neighbouring
identifier, are how that number goes to zero.

## How a reader knows this is wrong

`CONTRIBUTING.md` asks three questions, and the third decides.

1. **What question does this let someone answer?** Which of the things a repository declares a run has
   exercised, on repositories whose declarations are written in the forms the field actually uses, rather
   than only in the forms an adapter was taught.
2. **What evidence?** The pinned corpus, and specifically the numbers pre-registered in Stage 1.
3. **How would a reader know the answer is wrong?**

- **`crewai-examples-exercised`.** A declared-side fact must still leave
  `runtime.exercisedComponents` at 0 and the three role names ambiguous when the run carries no source
  identity. ADR 0007 moves the measured entry to 3 exercised components only because the run now carries
  the actual constructor frames, repository coordinate and revision. Removing any of those observed inputs
  must restore the refusal rather than preserve the join.
- **`crewai-examples`.** If `components.byKind.agent` does not fall from 121 toward the ~70 the repository
  declares, the fact model is not the ceiling on the repository chosen to demonstrate it.
- **`open-agent-platform`.** If `agentSystemDetected` ever reads `true`, or `components.byKind` gains an
  `agent`, `model`, `tool` or `mcp_server` key, recognition was widened without provenance and the entry
  did what its own prose predicted. This one falsifies ADR 0004 directly.
- **`openai-agents-js-filesystem-mcp`.** The recorded exercise must retain three source-qualified component
  joins and one cross-repository `calls_tool` relation. Removing either repository coordinate, changing either
  revision or removing the W3C parent must produce a named refusal rather than preserve that relation.
- **`orchescope-discovery`.** Ceiling zero components, in the one package where every framework name this
  build knows appears as a string literal. If a richer fact model lights it up, the facts stopped being
  facts about a program and became facts about text.
- **`open-deep-research-exercised`.** If it ever reads a majority of its declared components and edges as
  exercised with `byCodeLocation` above zero, Direction 4 was right and the run really is the map, and the
  1.25% ratios above are an artifact of thin drivers rather than a structural ceiling.
