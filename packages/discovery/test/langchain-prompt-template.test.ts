import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const scan = async (files: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-langchain-prompts-');
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'langchain-prompts-fixture',
      orchescopeVersion: '0.9.1',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 100,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
    });
  } finally {
    deadline.dispose();
    workspace.dispose();
  }
};

const prompts = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components.filter(
    (component) =>
      component.kind === 'prompt' && component.discoveredBy.includes('adapter:prompts'),
  );

const promptIn = (result: Awaited<ReturnType<typeof scan>>, file: string) =>
  prompts(result).find((component) =>
    component.sourceLocations.some((location) => location.file === file),
  );

describe('LangChain prompt template discovery', () => {
  it('uses exact direct, renamed and namespace import provenance', async () => {
    const result = await scan({
      'src/direct.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(question):
    prompt = ChatPromptTemplate.from_template("Answer {question}")
    return prompt.invoke({"question": question})
`,
      'src/renamed.py': `from langchain_core.prompts import ChatPromptTemplate as Template

def summarize(text):
    summary = Template.from_template("Summarize {text}")
    return summary.invoke({"text": text})
`,
      'src/namespace.py': `import langchain_core.prompts as prompts

def classify(value):
    classifier = prompts.ChatPromptTemplate.from_template("Classify {value}")
    return classifier.invoke({"value": value})
`,
    });

    assert.deepEqual(
      prompts(result)
        .map((component) => component.id)
        .sort(),
      ['prompt:answer.prompt', 'prompt:classify.classifier', 'prompt:summarize.summary'],
    );
    assert.ok(
      prompts(result).every(
        (component) =>
          component.details?.for === 'prompt' &&
          component.details.interpolatesUntrustedInput === true,
      ),
    );
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'uses_prompt'),
      false,
    );
    assert.ok(
      (result.graph.coverage.topology?.unresolved ?? []).some(
        (entry) =>
          entry.scope === 'prompt_use' && entry.reason.includes('consuming graph component'),
      ),
    );
  });

  it('retains semantic message roles through a fluent partial call', async () => {
    const result = await scan({
      'src/app.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(context, question):
    prompt = ChatPromptTemplate.from_messages([
        ("system", "Use the supplied context."),
        ("human", "Context: {context}\\nQuestion: {question}"),
    ]).partial()
    return prompt.invoke({"context": context, "question": question})
`,
    });

    const found = prompts(result);
    assert.deepEqual(found.map((component) => component.id).sort(), [
      'prompt:answer.prompt.human',
      'prompt:answer.prompt.system',
    ]);
    const human = found.find((component) => component.id.endsWith('.human'));
    const system = found.find((component) => component.id.endsWith('.system'));
    assert.equal(
      human?.details?.for === 'prompt' ? human.details.interpolatesUntrustedInput : undefined,
      true,
    );
    assert.equal(
      system?.details?.for === 'prompt' ? system.details.interpolatesUntrustedInput : undefined,
      false,
    );
  });

  it('uses the same provenance contract for JavaScript aliases and namespaces', async () => {
    const result = await scan({
      'src/app.ts': `import { ChatPromptTemplate as Template } from '@langchain/core/prompts';
import * as promptLibrary from '@langchain/core/prompts';

export function direct(question: string) {
  const prompt = Template.fromTemplate('Answer {question}');
  return prompt.invoke({ question });
}

export function namespaced(context: string) {
  const prompt = promptLibrary.ChatPromptTemplate.fromMessages([
    ['system', 'Use context.'],
    ['human', 'Context: {context}'],
  ]);
  return prompt.invoke({ context });
}
`,
    });

    assert.deepEqual(
      prompts(result)
        .map((component) => component.id)
        .sort(),
      ['prompt:direct.prompt', 'prompt:namespaced.prompt.human', 'prompt:namespaced.prompt.system'],
    );
  });

  it('stays quiet for foreign, local, shadowed, rebound and type-only lookalikes', async () => {
    const result = await scan({
      'src/foreign.py': `from other.prompts import ChatPromptTemplate
prompt = ChatPromptTemplate.from_template("Foreign {value}")
`,
      'src/local.py': `class ChatPromptTemplate:
    @staticmethod
    def from_template(value):
        return value
prompt = ChatPromptTemplate.from_template("Local {value}")
`,
      'src/shadow.py': `from langchain_core.prompts import ChatPromptTemplate

def build(ChatPromptTemplate):
    return ChatPromptTemplate.from_template("Shadow {value}")
`,
      'src/rebound.py': `from langchain_core.prompts import ChatPromptTemplate
ChatPromptTemplate = custom
prompt = ChatPromptTemplate.from_template("Rebound {value}")
`,
      'src/type-only.ts': `import type { ChatPromptTemplate } from '@langchain/core/prompts';
declare const ChatPromptTemplate: { fromTemplate(value: string): unknown };
const prompt = ChatPromptTemplate.fromTemplate('Type only {value}');
`,
    });

    assert.deepEqual(prompts(result), []);
  });

  it('refuses ownerless and repeated bindings without minting positional identities', async () => {
    const result = await scan({
      'src/app.py': `from langchain_core.prompts import ChatPromptTemplate

ChatPromptTemplate.from_template("Ownerless {value}")

def build():
    prompt = ChatPromptTemplate.from_template("First {value}")
    prompt = ChatPromptTemplate.from_template("Second {value}")
`,
    });

    assert.deepEqual(prompts(result), []);
    const refusals = (result.graph.coverage.topology?.unresolved ?? []).filter(
      (entry) => entry.scope === 'prompt_use',
    );
    assert.equal(refusals.length, 3);
    assert.ok(refusals.every((entry) => entry.location !== undefined));
    assert.ok(refusals.some((entry) => entry.reason.includes('no stable source binding')));
    assert.ok(refusals.some((entry) => entry.reason.includes('share source binding')));
  });

  it('does not borrow invocation evidence across duplicate lexical names or unnamed callbacks', async () => {
    const result = await scan({
      'src/scopes.py': `from langchain_core.prompts import ChatPromptTemplate

def build():
    prompt = ChatPromptTemplate.from_template("Answer {question}")
    return prompt

def build():
    return prompt.invoke({"question": question})
`,
      'src/callback.ts': `import { ChatPromptTemplate } from '@langchain/core/prompts';

items.map((question) => {
  const prompt = ChatPromptTemplate.fromTemplate('Answer {question}');
  return prompt.invoke({ question });
});
`,
    });

    assert.deepEqual(prompts(result), []);
    const refusals = (result.graph.coverage.topology?.unresolved ?? []).filter(
      (entry) => entry.scope === 'prompt_use',
    );
    assert.ok(refusals.some((entry) => entry.reason.includes('no stable source binding')));
  });

  it('distinguishes static aliases, parameters and computed invocation values', async () => {
    const result = await scan({
      'src/static.py': `from langchain_core.prompts import ChatPromptTemplate

def answer():
    fixed = "trusted"
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    return prompt.invoke({"value": fixed})
`,
      'src/runtime.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    return prompt.invoke({"value": value})
`,
      'src/computed.py': `from langchain_core.prompts import ChatPromptTemplate

def answer():
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    return prompt.invoke({"value": load_value()})
`,
    });

    const interpolation = (file: string) => {
      const details = promptIn(result, file)?.details;
      return details?.for === 'prompt' ? details.interpolatesUntrustedInput : undefined;
    };
    assert.equal(interpolation('src/static.py'), false);
    assert.equal(interpolation('src/runtime.py'), true);
    assert.equal(interpolation('src/computed.py'), undefined);
    const computed = (result.graph.coverage.topology?.unresolved ?? []).find((entry) =>
      entry.reason.includes('invocation binding value is computed'),
    );
    assert.equal(computed?.location?.startLine, 5);
  });

  it('settles exact partial bindings and refuses unrelated partial wrappers', async () => {
    const result = await scan({
      'src/static.py': `from langchain_core.prompts import ChatPromptTemplate

def answer():
    prompt = ChatPromptTemplate.from_template("Answer {value}").partial(value="trusted")
    return prompt.invoke({})
`,
      'src/runtime.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}").partial(value=value)
    return prompt.invoke({})
`,
      'src/computed.py': `from langchain_core.prompts import ChatPromptTemplate

def answer():
    prompt = ChatPromptTemplate.from_template("Answer {value}").partial(value=load_value())
    return prompt.invoke({})
`,
      'src/unrelated.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = fake.partial(ChatPromptTemplate.from_template("Answer {value}"))
    return prompt.invoke({"value": value})
`,
    });

    const interpolation = (file: string) => {
      const details = promptIn(result, file)?.details;
      return details?.for === 'prompt' ? details.interpolatesUntrustedInput : undefined;
    };
    assert.equal(interpolation('src/static.py'), false);
    assert.equal(interpolation('src/runtime.py'), true);
    assert.equal(interpolation('src/computed.py'), undefined);
    assert.equal(promptIn(result, 'src/unrelated.py'), undefined);
    const computed = (result.graph.coverage.topology?.unresolved ?? []).find((entry) =>
      entry.reason.includes('partial binding value is computed'),
    );
    assert.equal(computed?.location?.startLine, 4);
  });

  it('requires construction and invocation to share exact branch ownership', async () => {
    const result = await scan({
      'src/same.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(flag, value):
    if flag:
        prompt = ChatPromptTemplate.from_template("Answer {value}")
        return prompt.invoke({"value": value})
`,
      'src/join.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(flag, value):
    if flag:
        prompt = ChatPromptTemplate.from_template("Answer {value}")
    else:
        prompt = custom
    return prompt.invoke({"value": value})
`,
      'src/dominates.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(flag, value):
    if flag:
        prompt = custom
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    return prompt.invoke({"value": value})
`,
      'src/post.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    result = prompt.invoke({"value": value})
    prompt = custom
    return result
`,
    });

    const interpolation = (file: string) => {
      const details = promptIn(result, file)?.details;
      return details?.for === 'prompt' ? details.interpolatesUntrustedInput : undefined;
    };
    assert.equal(interpolation('src/same.py'), true);
    assert.equal(interpolation('src/join.py'), undefined);
    assert.equal(interpolation('src/dominates.py'), true);
    assert.equal(interpolation('src/post.py'), true);
    const joined = (result.graph.coverage.topology?.unresolved ?? []).find((entry) =>
      entry.reason.includes('reassigned before this template invocation'),
    );
    assert.equal(joined?.location?.startLine, 7);
  });

  it('supports direct and legacy constructors and refuses unsupported template formats', async () => {
    const result = await scan({
      'src/direct.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate([("human", "Answer {value}")])
    return prompt.invoke({"value": value})
`,
      'src/legacy.py': `from langchain.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    return prompt.invoke({"value": value})
`,
      'src/jinja.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {{ value }}", template_format="jinja2")
    return prompt.invoke({"value": value})
`,
    });

    assert.equal(promptIn(result, 'src/direct.py')?.id.endsWith('.human'), true);
    assert.notEqual(promptIn(result, 'src/legacy.py'), undefined);
    const jinja = promptIn(result, 'src/jinja.py')?.details;
    assert.equal(jinja?.for === 'prompt' ? jinja.interpolatesUntrustedInput : undefined, undefined);
    const refusal = (result.graph.coverage.topology?.unresolved ?? []).find((entry) =>
      entry.reason.includes('template_format jinja2'),
    );
    assert.equal(refusal?.location?.startLine, 4);
  });

  it('refuses mutated, escaped and captured prompt bindings before invocation', async () => {
    const result = await scan({
      'src/nonlocal.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def replace():
        nonlocal prompt
        prompt = foreign
    replace()
    return prompt.invoke({"value": value})
`,
      'src/argument.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    mutate(prompt)
    return prompt.invoke({"value": value})
`,
      'src/member.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    prompt.messages = foreign
    return prompt.invoke({"value": value})
`,
      'src/alias.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    box = {"prompt": prompt}
    mutate(box)
    return prompt.invoke({"value": value})
`,
      'src/closure.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    mutate()
    return prompt.invoke({"value": value})
`,
      'src/default.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate(alias=prompt):
        alias.messages = foreign
    mutate()
    return prompt.invoke({"value": value})
`,
      'src/destructured.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    alias, = (prompt,)
    mutate(alias)
    return prompt.invoke({"value": value})
`,
      'src/subscript.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    holder["prompt"] = prompt
    return prompt.invoke({"value": value})
`,
      'src/callable_alias.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    operation = mutate
    operation()
    return prompt.invoke({"value": value})
`,
      'src/wrapper.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def wrapper():
        mutate()
    wrapper()
    return prompt.invoke({"value": value})
`,
      'src/callable_parameter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def wrapper(fn):
        fn()
    wrapper(mutate)
    return prompt.invoke({"value": value})
`,
      'src/callable_default.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def wrapper(fn=mutate):
        fn()
    wrapper()
    return prompt.invoke({"value": value})
`,
      'src/nested_parameter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def outer(fn):
        def inner(next_fn):
            next_fn()
        inner(fn)
    outer(mutate)
    return prompt.invoke({"value": value})
`,
      'src/setter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        setattr(prompt, "messages", foreign)
    def wrapper():
        mutate()
    wrapper()
    return prompt.invoke({"value": value})
`,
      'src/deep_wrapper.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def five(): mutate()
    def four(): five()
    def three(): four()
    def two(): three()
    def one(): two()
    one()
    return prompt.invoke({"value": value})
`,
      'src/branch_join.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, flag):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    if flag:
        operation = mutate
    else:
        operation = safe
    operation()
    return prompt.invoke({"value": value})
`,
      'src/deep_nested.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def wrapper():
        def mutate():
            prompt.messages = foreign
        mutate()
    wrapper()
    return prompt.invoke({"value": value})
`,
      'src/deep_setter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def wrapper():
        def mutate():
            setattr(prompt, "messages", foreign)
        mutate()
    wrapper()
    return prompt.invoke({"value": value})
`,
      'src/dynamic_setter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, field):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        setattr(prompt, field, foreign)
    mutate()
    return prompt.invoke({"value": value})
`,
      'src/captured_parameter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def outer(fn):
        def inner():
            fn()
        inner()
    outer(mutate)
    return prompt.invoke({"value": value})
`,
      'src/reassigned_capture.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=safe):
        fn = mutate
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/conditional_default_fallback.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, flag):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=mutate):
        if flag:
            fn = safe
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/conditional_mutate.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, flag):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=safe):
        if flag:
            fn = mutate
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/exhaustive_mutate.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, flag):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=safe):
        if flag:
            fn = safe
        else:
            fn = mutate
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/nested_incomplete_branch.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, outer_flag, inner_flag):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=mutate):
        if outer_flag:
            if inner_flag:
                fn = safe
            else:
                fn = safe
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/returned_callable.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def factory():
        return mutate
    factory()()
    return prompt.invoke({"value": value})
`,
      'src/decorated_callable.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def replace(fn):
        return mutate
    @replace
    def safe():
        return None
    safe()
    return prompt.invoke({"value": value})
`,
      'src/destructured_callable.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    operation, = (mutate,)
    operation()
    return prompt.invoke({"value": value})
`,
      'src/destructured_safe.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def safe():
        return None
    operation, = (safe,)
    operation()
    return prompt.invoke({"value": value})
`,
    });

    for (const file of [
      'src/nonlocal.py',
      'src/argument.py',
      'src/member.py',
      'src/alias.py',
      'src/closure.py',
      'src/default.py',
      'src/destructured.py',
      'src/subscript.py',
      'src/callable_alias.py',
      'src/wrapper.py',
      'src/callable_parameter.py',
      'src/callable_default.py',
      'src/nested_parameter.py',
      'src/setter.py',
      'src/deep_wrapper.py',
      'src/branch_join.py',
      'src/deep_nested.py',
      'src/deep_setter.py',
      'src/dynamic_setter.py',
      'src/captured_parameter.py',
      'src/reassigned_capture.py',
      'src/conditional_default_fallback.py',
      'src/conditional_mutate.py',
      'src/exhaustive_mutate.py',
      'src/nested_incomplete_branch.py',
      'src/returned_callable.py',
      'src/decorated_callable.py',
      'src/destructured_callable.py',
    ]) {
      const details = promptIn(result, file)?.details;
      assert.equal(
        details?.for === 'prompt' ? details.interpolatesUntrustedInput : undefined,
        undefined,
        file,
      );
    }
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(refusals.length > 0);
    assert.ok(refusals.every((entry) => entry.location !== undefined));
    const safeDestructure = promptIn(result, 'src/destructured_safe.py')?.details;
    assert.equal(
      safeDestructure?.for === 'prompt' ? safeDestructure.interpolatesUntrustedInput : undefined,
      true,
    );
  });

  it('does not borrow dead or pre-construction nested mutations', async () => {
    const result = await scan({
      'src/dead.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    return prompt.invoke({"value": value})
`,
      'src/preconstruction.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    def mutate():
        prompt.messages = foreign
    mutate()
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    return prompt.invoke({"value": value})
`,
      'src/safe_alias.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def safe():
        return None
    operation = safe
    operation()
    return prompt.invoke({"value": value})
`,
      'src/rebound_alias.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    operation = mutate
    operation = safe
    operation()
    return prompt.invoke({"value": value})
`,
      'src/dead_wrapper.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def wrapper():
        mutate()
    return prompt.invoke({"value": value})
`,
      'src/safe_cycle.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def first():
        second()
    def second():
        first()
    first()
    return prompt.invoke({"value": value})
`,
      'src/safe_parameter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def safe():
        return None
    def wrapper(fn):
        fn()
    wrapper(safe)
    return prompt.invoke({"value": value})
`,
      'src/safe_default.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def safe():
        return None
    def wrapper(fn=safe):
        fn()
    wrapper()
    return prompt.invoke({"value": value})
`,
      'src/safe_setter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, other):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        setattr(other, "messages", foreign)
    mutate()
    return prompt.invoke({"value": value})
`,
      'src/safe_captured_parameter.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def safe():
        return None
    def outer(fn):
        def inner():
            fn()
        inner()
    outer(safe)
    return prompt.invoke({"value": value})
`,
      'src/safe_reassigned_capture.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=mutate):
        fn = safe
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/exhaustive_safe.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, flag):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=mutate):
        if flag:
            fn = safe
        else:
            fn = safe
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/nested_exhaustive_safe.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value, outer_flag, inner_flag):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=mutate):
        if outer_flag:
            if inner_flag:
                fn = safe
            else:
                fn = safe
        else:
            fn = safe
        def inner():
            fn()
        inner()
    outer()
    return prompt.invoke({"value": value})
`,
      'src/postuse_capture.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def mutate():
        prompt.messages = foreign
    def safe():
        return None
    def outer(fn=safe):
        def inner():
            fn()
        inner()
        fn = mutate
    outer()
    return prompt.invoke({"value": value})
`,
      'src/dead_decorated.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    def replace(fn):
        return foreign
    @replace
    def safe():
        return None
    return prompt.invoke({"value": value})
`,
    });
    for (const file of [
      'src/dead.py',
      'src/preconstruction.py',
      'src/safe_alias.py',
      'src/rebound_alias.py',
      'src/dead_wrapper.py',
      'src/safe_cycle.py',
      'src/safe_parameter.py',
      'src/safe_default.py',
      'src/safe_setter.py',
      'src/safe_captured_parameter.py',
      'src/safe_reassigned_capture.py',
      'src/exhaustive_safe.py',
      'src/nested_exhaustive_safe.py',
      'src/postuse_capture.py',
      'src/dead_decorated.py',
    ]) {
      const details = promptIn(result, file)?.details;
      assert.equal(
        details?.for === 'prompt' ? details.interpolatesUntrustedInput : undefined,
        true,
        file,
      );
    }
  });

  it('retains only exact invocation evidence before a later foreign binding', async () => {
    const result = await scan({
      'src/app.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(first, second):
    prompt = ChatPromptTemplate.from_template("Answer {value}")
    prompt.invoke({"value": first})
    prompt = foreign
    return prompt.invoke({"value": second})
`,
    });

    const prompt = promptIn(result, 'src/app.py');
    assert.equal(
      prompt?.details?.for === 'prompt' ? prompt.details.interpolatesUntrustedInput : undefined,
      true,
    );
    assert.ok(prompt?.sourceLocations.some((location) => location.startLine === 5));
    assert.equal(
      prompt?.sourceLocations.some((location) => location.startLine === 7),
      false,
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) => entry.location?.startLine === 6 && entry.reason.includes('reassigned'),
      ),
    );
  });

  it('applies partial and invocation bindings in runtime precedence order', async () => {
    const result = await scan({
      'src/fluent.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate(
        [("human", "Answer {value}")],
        partial_variables={"value": "trusted"},
    ).partial(value=value)
    return prompt.invoke({})
`,
      'src/invocation.py': `from langchain_core.prompts import ChatPromptTemplate

def answer(value):
    prompt = ChatPromptTemplate.from_template(
        "Answer {value}", partial_variables={"value": "trusted"}
    )
    return prompt.invoke({"value": "trusted", "value": value})
`,
    });

    for (const file of ['src/fluent.py', 'src/invocation.py']) {
      const details = promptIn(result, file)?.details;
      assert.equal(
        details?.for === 'prompt' ? details.interpolatesUntrustedInput : undefined,
        true,
        file,
      );
    }
  });

  it('settles JavaScript fluent partial values without lending computed data', async () => {
    const result = await scan({
      'src/static.ts': `import { ChatPromptTemplate } from '@langchain/core/prompts';
export function answer() {
  const prompt = ChatPromptTemplate.fromTemplate('Answer {value}').partial({ value: 'trusted' });
  return prompt.invoke({});
}
`,
      'src/runtime.ts': `import { ChatPromptTemplate } from '@langchain/core/prompts';
export function answer(value: string) {
  const prompt = ChatPromptTemplate.fromTemplate('Answer {value}').partial({ value });
  return prompt.invoke({});
}
`,
      'src/computed.ts': `import { ChatPromptTemplate } from '@langchain/core/prompts';
export function answer() {
  const prompt = ChatPromptTemplate.fromTemplate('Answer {value}').partial({ value: loadValue() });
  return prompt.invoke({});
}
`,
    });

    const interpolation = (file: string) => {
      const details = promptIn(result, file)?.details;
      return details?.for === 'prompt' ? details.interpolatesUntrustedInput : undefined;
    };
    assert.equal(interpolation('src/static.ts'), false);
    assert.equal(interpolation('src/runtime.ts'), true);
    assert.equal(interpolation('src/computed.ts'), undefined);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.location?.file === 'src/computed.ts' &&
          entry.reason.includes('partial binding value is computed'),
      ),
    );
  });
});
