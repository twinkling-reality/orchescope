# ADR 0003: The fact model is the breadth lever, and a fact records only what the syntax says

- Status: accepted
- Date: 2026-08-20
- Deciders: repository maintainers

## Context

Thirteen per framework adapters produce the declared half of the join, 5,493 lines against 42,077 that
know no framework name. The observation half is 2,491 lines carrying one framework identifier, because a
run emits standardised telemetry and source has no standard. The question this decides is where breadth
comes from as agent systems proliferate, given that answer.

ADR 0002 removed the model path on three measurements, and re-run on 27 entries all three have
strengthened. Its second measurement said every gap the corpus reports is an adapter form in an already
parsed language. Read one at a time, the seven reported gaps are three different things: two are false,
four are correct refusals, and one is an unwritten adapter form of roughly thirty lines. The false
pair is the sharpest. `crewai-examples` reports that the `agents` distribution is imported and its adapter
found nothing; three `main.py` files write `from agents import ...` and each has a sibling `agents.py`, and
no checkout in that repository declares such a distribution. `adapter:openai-agents` is recorded as having
run on three files of a repository that uses none of it.

So the coverage claim rests on a fact the model does not carry: whether an import specifier names a
distribution or this repository's own module. `matching.ts:59-73` guesses it from path shape for the
matching layer, and `discover.ts:146-156`, which writes the coverage claim, does not even do that.

The same shape appears wherever an adapter had to reach around the fact model.

**The fact model is described as language neutral and is not.** `facts.ts:5-12` states the neutrality is
what lets one adapter cover a framework in both ecosystems. Measured on one program,
`Agent(config=self.agents_config['k'])` in Python records `{"kind":"unknown","nodeType":"subscript"}` while
the identical TypeScript records `{"kind":"member","path":["agentsConfig","k"]}`. `{kind:'arithmetic'}` is
produced 2,236 times in JavaScript and 0 times in Python, while 2,798 Python `binary_operator` arguments
drop to `unknown`; the failure `facts.ts:47-52` says that fact exists to prevent, a real exponential
backoff reported as `backoff: 'unknown'`, is still live for every Python retry written as an expression.
A Python module scope constant reaches `prompts.ts` with `enclosing: undefined` where the JavaScript one
carries its name.

**`subscript` is the largest hole in every Python entry without exception.** It is the most common unknown
`nodeType` in all seven Python corpus checkouts. Restricted to keyword arguments, the share carrying a
string literal key, which is what a fact would recover with no resolution at all, is 91% on
`crewai-examples`, 88% on `open-deep-research` and 79% on `gpt-researcher`.

**The model already resolves something the syntax leaves open.** `javascript/analyze.ts:82-89` walks a
`MemberExpression` without checking `computed`, so `listeners[i](1)` is recorded with the callee path
`["listeners","i"]`, indistinguishable from `listeners.i(1)`. That is a property name the source never
wrote, at 2,854 sites, 510 of them in positions the reducer reads. It is latent rather than live, because
none of the 187 callee cases produces a segment an adapter matches on, and it is exactly the class the
prohibition against presenting an inference as an observation exists to prevent. The
`ComputedMemberExpression` branch immediately below at `:90-97` does require a literal and is dead code:
that node type occurs 0 times in 5,050 corpus files under oxc 0.141.

**And the two missing facts are the whole of a join this build declined to make.** `crewai create crew`
writes an agent's role into `config/agents.yaml` and selects it with
`Agent(config=self.agents_config['lead_market_analyst'])`. Every step of that chain is already a fact
except the subscript key and the class attribute's literal, which `DefinitionFact` has no field for. On
the pinned repository, 49 of 49 such subscripts carry a string literal key and 19 of 19 `@CrewBase`
classes declare the path as a string literal. Simulated over the whole repository, reading only those two
values from source and using real facts for everything else, **41 links resolve exactly, 8 decline, 0 attach
wrongly.** That is a simulation rather than a re-run, and converting it into a corpus number is what this
decision is funding. The substitute in the tree, the enclosing method name, scores 34 right, 10 wrong and 5
undecidable on the same 49, and two of its ten errors split one declared agent into two without being able to
tell that it did.

The alternative levers were measured and are worse. A convention driven reader on the declared side flips
`open-agent-platform` from `not_agent_system` to detected, measured, and its confidence band cannot stop
it because nothing that decides identity reads one. A model that writes a reader moves 954 authored lines
and none of the three follow up commits. A run primary map reports 38 components against source's 3,033.

## Decision

**The fact model is where breadth on the declared side is bought, and a fact records what the syntax says
and resolves nothing.**

The test applied to every proposed fact is one sentence: does this record what is written, or does it
resolve something the syntax leaves open. Under it:

- A subscript or index carrying a **literal** key is recorded, in both languages, because `x['k']` selects
  by the language definition the entry literally named `k`. A **variable** key stays `unknown`, and the
  JavaScript branch that records one today is corrected as part of the same change.
- A definition's **literal value** is recorded, keeping `initializer` beside it and listing every literal
  bound to the name rather than choosing one, which is the rule `aliasedFrom` already states at
  `facts.ts:113-124`. Recording the literal is unconditionally true. Substituting it is not, and
  `@CrewBase` replacing the attribute before the method runs is the case that proves it.
- Python gains the `arithmetic` parity JavaScript has, because operators and names are a flattening rather
  than an evaluation, and porting it removes an asymmetry rather than adding a claim.
- Whether an import resolves to a file in the scanned set is recorded, filesystem exact, refusing where
  more than one candidate exists. It cannot be a field on `ModuleFacts`: the cache key is the file digest
  and a cross module fact would break that invariant, so it is an index computed over the fact set.
- **Intra module constant propagation is rejected.** It resolves what the syntax leaves open by
  construction. Measured payoff is 16 of 337 unresolved request addresses, 4.7%, with 9 cases where more
  than one binding is a candidate and choosing would be a guess.

`ModuleFacts` lives in `packages/source-analysis`, not in `packages/schema`. Nothing under `schemas/` is
generated from it and no published document version moves, which is why this lever is available without a
contract change and why it is preferred over every alternative that needs one.

## Consequences

**Adapters shrink where a fact replaces a guess, and that is not the point.** The CrewAI adapter loses its
enclosing name fallback and roughly 49 lines of comment explaining why the join was unavailable, and stops
producing two components for one agent. The cost per new framework does not fall materially. This is a
correctness decision that a cost argument does not carry.

**The unit of work for breadth changes.** "Teach an adapter a form" becomes, where the form is legible,
"record the fact the form is written in", and that fact is available to every adapter at once rather than
to the one that asked for it. Five of the eight framework adapters already required a shared extraction or
a source analysis change when they were taught a form, which is why the per adapter line count has been
flat rather than falling.

**A coverage claim becomes answerable.** A reported gap can be a form this build does not read, a client
import with nothing to declare, or a name collision with the repository's own module, and today all three
render identically. The resolved import index is what separates them.

**One live defect is closed.** `arr[i]` stops being recorded as `arr.i`.

## What the measurement said

Both criteria were pre-registered before anything was recorded, and both were met.

**`crewai-examples` `components.byKind.agent` fell from 121 to 81.** The arithmetic closes with nothing left
over. That repository writes 71 `Agent(` calls, 49 selecting a document entry and 22 carrying a literal role.
Of the 49, **41 resolve and 8 decline**, reproducing the simulation this decision was funded on to the call.
78 of the 81 are CrewAI's and decompose as 39 agents carrying both a document entry and a call site, 9
entries no call selects, and 30 calls with nothing to join to: 39 plus 9 is the 48 entries the documents
declare, and 41 plus 30 is the 71 calls. The 8 declines are the two cases named in advance, five where
`agents_config = yaml.safe_load(file)` carries no literal and three where the code selects keys the document
does not declare.

**`crewai-examples-exercised` still reports 0 exercised components and the same three ambiguous names**,
verbatim with their trailing newlines, and `joined` and `joinedOnNameAlone` are still empty. The join is
between two declarations and it did not become a join to a run.

The per language measurements held too. The Python subscript fact reads 141 of 165 previously unknown
subscripts on `crewai-examples`, 34 of 48 on `open-deep-research` and 122 of 183 on `gpt-researcher`, with
the `member` count rising by exactly the amount the unknown count falls on each. The JavaScript correction
removed 206 callee paths, 494 member argument facts and 63 environment reads that named a variable rather
than a variable's value, one of them in this build's own demonstration system. 21 of 22 `agents_config`
definitions carry their literal, and the twenty second is the `yaml.safe_load` case.

## What would reverse this

**A fact that records only syntax, measured to produce a confidently wrong answer on a pinned repository.**
The standing measurement is `crewai-examples-exercised`: if `runtime.exercisedComponents` rises above 0 or
`runtime.ambiguousNames` empties, a fact resolved something the syntax left open, the two halves of the
join agree by construction, and this decision was wrong rather than the change being wrong.

**Or a later fact whose payoff is bought by resolving rather than recording.** Intra module constant
propagation stays rejected on the measurement above, and a proposal that reaches for it under another name
is the same proposal.
