import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzePython } from '../src/python/analyze.ts';

const analyze = (text: string) =>
  analyzePython({ file: 'src/types.py', text, contentHash: 'c'.repeat(64) });

const imported = (facts: Awaited<ReturnType<typeof analyze>>, local: string) =>
  facts.imports.find((entry) => entry.local === local);

describe('Python TYPE_CHECKING import roles', () => {
  it('marks exact direct and namespace aliases and their nested consequence imports as type-only', async () => {
    const facts = await analyze(`from typing import TYPE_CHECKING as CHECK_TYPES
import typing as typing_namespace
import typing_extensions as extensions_namespace

if CHECK_TYPES:
    from langchain.agents import create_agent as direct_factory
    if feature_enabled:
        from package import NestedType

if typing_namespace.TYPE_CHECKING:
    from package import NamespaceType

if extensions_namespace.TYPE_CHECKING:
    from package import ExtensionType
`);

    assert.equal(imported(facts, 'direct_factory')?.isType, true);
    assert.equal(imported(facts, 'NestedType')?.isType, true);
    assert.equal(imported(facts, 'NamespaceType')?.isType, true);
    assert.equal(imported(facts, 'ExtensionType')?.isType, true);
    assert.equal(imported(facts, 'CHECK_TYPES')?.isType, false);
  });

  it('marks conjunction and elif consequences type-only while keeping other guards runtime', async () => {
    const facts = await analyze(`from typing import TYPE_CHECKING
from project.typing import TYPE_CHECKING as LOOKALIKE

if not TYPE_CHECKING:
    from package import Negated

if TYPE_CHECKING and feature_enabled:
    from package import Compound

if feature_enabled and (TYPE_CHECKING):
    from package import ReorderedCompound

if (feature_enabled and TYPE_CHECKING) and another_flag:
    from package import NestedCompound

if TYPE_CHECKING or feature_enabled:
    from package import Disjunction

if enabled(TYPE_CHECKING):
    from package import Dynamic

if LOOKALIKE:
    from package import Lookalike

if feature_enabled:
    from package import Consequence
elif TYPE_CHECKING:
    from package import Alternative
else:
    from package import ElseBranch
`);

    for (const name of ['Compound', 'ReorderedCompound', 'NestedCompound', 'Alternative']) {
      assert.equal(imported(facts, name)?.isType, true, `${name} was left as runtime`);
    }
    for (const name of [
      'Negated',
      'Disjunction',
      'Dynamic',
      'Lookalike',
      'Consequence',
      'ElseBranch',
    ]) {
      assert.equal(imported(facts, name)?.isType, false, `${name} was promoted to type-only`);
    }
  });

  it('refuses locally shadowed and rebound guard aliases', async () => {
    const facts = await analyze(`from typing import TYPE_CHECKING as CHECK_TYPES
import typing as typing_namespace

CHECK_TYPES = runtime_setting
typing_namespace = runtime_typing

if CHECK_TYPES:
    from package import ReboundDirect

if typing_namespace.TYPE_CHECKING:
    from package import ReboundNamespace

def configure(CHECK_TYPES):
    if CHECK_TYPES:
        from package import ParameterShadow
`);

    assert.equal(imported(facts, 'ReboundDirect')?.isType, false);
    assert.equal(imported(facts, 'ReboundNamespace')?.isType, false);
    assert.equal(imported(facts, 'ParameterShadow')?.isType, false);
  });

  it('restores the runtime binding after a type-only consequence', async () => {
    const facts = await analyze(`from langchain.agents import create_agent
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from type_stubs import create_agent
    typed = create_agent(model="stub", tools=[])

runtime = create_agent(model="openai:gpt", tools=[])
`);

    const calls = facts.calls.filter((call) => call.calleePath.at(-1) === 'create_agent');
    assert.equal(calls[0]?.origin?.isType, true);
    assert.deepEqual(calls[1]?.origin, {
      module: 'langchain.agents',
      imported: 'create_agent',
      isType: false,
    });
  });
});
