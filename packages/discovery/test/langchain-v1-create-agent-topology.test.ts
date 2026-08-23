import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adapterRun, scanLangChainV1 } from './langchain-v1-scan.ts';

describe('LangChain v1 create_agent topology', () => {
  it('records literal model references and direct local tool lists', async () => {
    const result = await scanLangChainV1({
      'src/app.py': `from langchain.agents import create_agent


def lookup_order():
    return "found"


support = create_agent("anthropic:claude-3-7-sonnet", [lookup_order])
`,
    });

    assert.ok(result.graph.components.some((component) => component.id === 'agent:support'));
    assert.ok(
      result.graph.components.some(
        (component) => component.id === 'model:anthropic/claude-3-7-sonnet',
      ),
    );
    assert.ok(result.graph.components.some((component) => component.id === 'provider:anthropic'));
    assert.ok(result.graph.components.some((component) => component.id === 'tool:lookup_order'));
    assert.deepEqual(
      result.graph.edges
        .filter((edge) => edge.discoveredBy.includes('adapter:langchain-v1-create-agent'))
        .map((edge) => edge.kind)
        .sort(),
      ['calls_tool', 'invokes_model', 'served_by_provider'],
    );
    const producer = result.graph.coverage.topology?.producers.find(
      (entry) => entry.adapterId === 'adapter:langchain-v1-create-agent',
    );
    assert.deepEqual(producer, {
      adapterId: 'adapter:langchain-v1-create-agent',
      status: 'complete',
      inspectedInputs: 1,
      relationsFound: 3,
    });
  });

  it('keeps every computed or unresolved endpoint absent and source-locates the refusal', async () => {
    const result = await scanLangChainV1({
      'src/app.py': `from langchain.agents import create_agent


def make_model():
    return object()


def make_tool():
    return object()


support = create_agent(model=make_model(), tools=[make_tool()])
`,
    });

    assert.ok(result.graph.components.some((component) => component.id === 'agent:support'));
    assert.equal(
      result.graph.components.some(
        (component) =>
          component.discoveredBy.includes('adapter:langchain-v1-create-agent') &&
          (component.kind === 'model' || component.kind === 'tool'),
      ),
      false,
    );
    const topology = result.graph.coverage.topology;
    assert.equal(topology?.status, 'incomplete');
    assert.equal(topology?.unresolvedCount, 2);
    assert.deepEqual(
      topology?.unresolved.map((entry) => entry.location?.startLine),
      [12, 12],
    );
    assert.ok(topology?.unresolved.every((entry) => entry.kind === 'explicit_relation'));
  });

  it('states a completed-zero inspected population when an exact import has no supported call', async () => {
    const result = await scanLangChainV1({
      'src/app.py': `from langchain.agents import create_agent

FACTORY = create_agent
`,
    });

    assert.deepEqual(adapterRun(result), {
      adapterId: 'adapter:langchain-v1-create-agent',
      adapterVersion: '1',
      applicability: {
        relevantImports: 1,
        distinctFiles: 1,
        sample: [
          {
            module: 'langchain.agents',
            imported: 'create_agent',
            location: {
              file: 'src/app.py',
              startLine: 1,
              startColumn: 29,
              endLine: 1,
              endColumn: 41,
            },
          },
        ],
        omittedImports: 0,
      },
      componentsFound: 0,
      edgesFound: 0,
      filesInspected: 1,
      languages: ['python'],
      durationMs: 0,
      status: 'completed',
    });
    const producer = result.graph.coverage.topology?.producers.find(
      (entry) => entry.adapterId === 'adapter:langchain-v1-create-agent',
    );
    assert.deepEqual(producer, {
      adapterId: 'adapter:langchain-v1-create-agent',
      status: 'complete',
      inspectedInputs: 1,
      relationsFound: 0,
    });
    assert.ok(
      result.graph.coverage.unsupported.some(
        (area) =>
          area.kind === 'adapter_found_nothing' &&
          area.area.includes('adapter:langchain-v1-create-agent'),
      ),
    );
  });
});
