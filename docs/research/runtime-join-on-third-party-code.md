# The runtime join on code this repository did not write

The declared against exercised delta is the defensible centre of this product, and until this was written it had only
ever been demonstrated on `apps/demo`, which Orchescope also wrote. A join that only works on its author's code is not
evidence of anything. This is the account of the first join against a third party repository: what was run, which names
matched, which did not, and why.

## What was run

`pydantic/pydantic-ai` at `ed0f40c0e5061722f7d9f579ed7efff1b74e3ea5`, the commit `corpus/corpus.yaml` pins. The
repository's own `bank_support` example declares one agent, one tool and one model:

```python
support_agent = Agent('openai:gpt-5.2', deps_type=SupportDependencies, output_type=SupportOutput, instructions=...)

@support_agent.tool
async def customer_balance(ctx: RunContext[SupportDependencies]) -> str: ...
```

`corpus/runs/pydantic-ai/exercise.py` runs it through `orchescope trace`, with the library's own `TestModel` in place
of the provider. No credential is used and no request leaves the process: the driver forces a placeholder API key so a
real one in the environment cannot be picked up, and sets `ALLOW_MODEL_REQUESTS` to false so an attempted request
raises rather than being sent.

Four spans arrived, in one trace:

| Span | The names it offered |
| --- | --- |
| `invoke_agent agent` | `gen_ai.agent.name=agent`, `agent_name=agent`, `model_name=test` |
| `chat test` | `gen_ai.request.model=test`, `gen_ai.provider.name=test`, `gen_ai.agent.name=agent` |
| `execute_tool customer_balance` | `gen_ai.tool.name=customer_balance`, `gen_ai.agent.name=agent` |
| `chat test` (second turn) | as above |

## Name by name

**`customer_balance` matched, and this is the result that matters.** The tool is declared at
`examples/pydantic_ai_examples/bank_support.py:72` by a decorator, and the instrumentation reported it under exactly the
same name. Nothing was configured to make that work. A tool defined by a decorator in third party Python joins to the
span that executed it, which is the claim this product makes and had not previously tested outside its own demonstration.

**`support_agent` did not match, and an `agent` appeared instead.** The example does not pass a name to `Agent(...)`, so
every span carries `gen_ai.agent.name=agent`: the word for the kind, not the name of the thing. The adapter reads the
variable, because that is what the library infers at run time in other contexts, and records `agent:support_agent`. The
two cannot meet. The declaration stayed unexercised and a runtime only component called `agent` appeared beside it, so
the same agent was counted twice, once in each direction.

This was worth a change rather than a note. `exercised-not-declared` used to claim the runtime component "runs without
being declared anywhere in the repository", which is false here: it is declared, under a name the run did not report.
A new rule, `observed-name-carries-no-identity`, reports it as an observability defect instead, with the bounded fix
(name the agent at its definition, or map it with `runtimeName` in the manifest) and a rerun as the check. The test for
it is `packages/findings/test/reconciliation-rules.test.ts`.

The comparison is on the shape of the name, not on a list of library defaults: an observed name that normalises to its
own kind identifies nothing, whichever library emitted it. A list of the fallback names each library uses would be
wrong the moment one of them changed.

**`test` matched a declaration in a different file, which is an accidental match.** `TestModel` reports
`gen_ai.request.model=test`, and the repository does declare a model called `test`, at
`tests/ext/test_langchain.py:75`. So the join succeeded by name and joined the run to a declaration that has nothing to
do with the example that produced it. Nothing here is wrong by its own rules: a name based join across a repository
with one flat namespace will do this, and Orchescope has no evidence that would distinguish the two. It is recorded
because the coverage number it produces is right for the wrong reason, and because the honest fix is scoping identity
to a module rather than to a repository, which is a design question and not a patch.

**`openai:gpt-5.2` was declared and never exercised, correctly.** The example names an OpenAI model and the run used
`TestModel`, so the delta says that declaration was not exercised. That is the right answer to the question that was
asked.

**The provider was not joined at all.** `gen_ai.provider.name=test` produced no provider component, while the static
side declares `provider:openai` from the same call. Provider identity is read from a declaration and not from a span,
so nothing tried to join it.

## What the delta says

```
runtime  4 span(s), 3 of 917 components exercised, 1 without a declaration
joined                  model:test, tool:customer_balance
exercisedNotDeclared    agent:agent
```

That is committed in `corpus/expected/pydantic-ai-exercised.json` and rechecked by `pnpm corpus:exercise`, so each of
those names is now a number that a change has to keep or explain.

## What this does not establish

One repository, one example, one library, one run of four spans. It establishes that the join works on code this
repository did not write, and it names the three ways it can be wrong: a generic name that identifies nothing, an
accidental match across a flat namespace, and a component kind nothing attempts to join. It does not establish anything
about JavaScript instrumentation, about a system with more than one agent running at once, or about a repository whose
runtime names are generated rather than written.
