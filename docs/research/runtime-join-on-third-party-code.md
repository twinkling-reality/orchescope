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
about a system with more than one agent running at once, or about a repository whose runtime names are generated rather
than written.

# The same join in JavaScript

Instrumentation is the half of this that differs most between languages, and a decoder that reads one dialect says
nothing about the other. This is the second join, in JavaScript, and it found a defect the Python one could not.

## What was run

`vercel/ai-chatbot` at `c2f8235e1f3ea903ad8b7f61447c4f74164b5c58`, driven by `corpus/runs/vercel-ai-chatbot/exercise.mjs`
through two pieces of that repository rather than reimplementations of them: `lib/ai/models.mock.ts`, the offline model
it uses for its own end to end tests, and `lib/ai/tools/get-weather.ts`, a tool declared with the SDK's own `tool()`.
The tool is called with no arguments, which is the branch of its own code that answers without contacting a weather
service, so a real third party tool executes and nothing outside the machine is contacted.

Two things about the SDK are worth recording, because both would look like a broken join from the outside:

- **From version 7 the SDK emits no spans until a telemetry integration is registered.** OpenTelemetry moved out of
  `ai` and into `@ai-sdk/otel`, and `experimental_telemetry: { isEnabled: true }` on its own now produces nothing at
  all. A driver written against the version 6 documentation runs, succeeds and exports zero spans.
- **What it emits is the generative AI convention, not a dialect of its own.** `gen_ai.operation.name` carries `chat`,
  `execute_tool`, `invoke_agent` and `agent_step`; the tool arrives as `gen_ai.tool.name`. Nothing had to be taught to
  the reader, which is the strongest evidence yet that reading the convention rather than a vendor's spelling was the
  right call.

Six spans arrived across the two steps of one generation.

## The defect this found

`tool:getweather` arrived exercised and joined nothing, while the repository declares that tool. It declares it
**twice**: once at `lib/ai/tools/get-weather.ts` where `tool()` is called, and once at `app/(chat)/api/chat/route.ts`
where the tool is passed into a `tools` map. Identity is `(kind, module, local name)`, so those were two components,
and reconciliation refuses an ambiguous match by design: exactly one declared component of a kind may carry a name for
the `kind_and_name` rule to fire.

The cause was module resolution. The route imports the tool as `@/lib/ai/tools/get-weather`, a path alias, and the
symbol index resolved relative specifiers only. An unresolved reference becomes a new component rather than a reference
to an existing one, so the same tool was declared once per module that mentioned it. The index now resolves `@/` and
`~/`, which cannot be package names because an npm scope is never empty, and a `paths` mapping in any other spelling is
still not followed. The repository went from 46 components to 41, with all 30 relations kept and now pointing at one
tool each.

## What the delta says

```
runtime  6 span(s), 3 of 19 components exercised, 2 without a declaration
joined                  tool:getweather
exercisedNotDeclared    agent:corpus-exercise, model:mock/mock-model
```

Both undeclared names are honest. The agent is the driver's own, because the application's agents are Next.js server
actions that need a request, a session and a database, and none of that is available to a corpus run. The model is the
repository's own mock, which the repository declares nowhere because it declares models by gateway identifier. Naming
the driver's agent after one of the application's would have staged a join rather than measured one.

That is committed in `corpus/expected/vercel-ai-chatbot-exercised.json` and rechecked by `pnpm corpus:exercise`.
