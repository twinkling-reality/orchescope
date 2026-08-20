import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OrchescopeError } from '@orchescope/domain';
import { validate } from '@orchescope/schema';
import { HANDLER_NAMES } from '../src/handlers.ts';
import { SERVER_INSTRUCTIONS } from '../src/instructions.ts';
import { TOOL_DEFINITIONS, toolByName } from '../src/tools.ts';

/**
 * The agent facing contract.
 *
 * A coding agent decides what to call from the advertised list, so the list has to be accurate: every tool has a schema
 * a caller can validate against, a description that says what it returns, and an annotation that tells the truth about
 * whether it changes anything. These tests hold that contract without starting a server, so they run everywhere.
 */

describe('the advertised tools', () => {
  it('are uniquely named and use the same naming shape', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    assert.equal(new Set(names).size, names.length, 'two tools share a name');
    for (const name of names) {
      assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} is not a lowercase identifier`);
    }
  });

  it('each carry a description that says what the caller gets back', () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.ok(tool.description.length > 40, `${tool.name} has a thin description`);
      assert.ok(
        /return|report|list|write|identifier|summar/i.test(tool.description),
        `${tool.name} does not say what it returns`,
      );
    }
  });

  it('each accept an object schema that rejects an unknown field', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const schema = tool.input as { type?: string; additionalProperties?: boolean };
      assert.equal(schema.type, 'object', `${tool.name} does not take an object`);
      assert.equal(
        schema.additionalProperties,
        false,
        `${tool.name} accepts unknown fields, so a caller cannot tell a typo from an option`,
      );
    }
  });

  it('never annotate an executing tool as read only', () => {
    // Read only and executing are separate properties: creating a goal writes to the store without running the audited
    // system, so it is not read only and does not execute. Executing, though, always implies not read only.
    for (const tool of TOOL_DEFINITIONS) {
      if (tool.executes) {
        assert.equal(
          tool.annotations.readOnlyHint,
          false,
          `${tool.name} runs the audited system and claims to be read only`,
        );
      }
      assert.ok(tool.annotations.title.length > 0, `${tool.name} has no title`);
    }
  });

  it('annotate every tool that writes as not read only', () => {
    const writes = ['create_improvement_goal', 'export_report', 'compare_runs'];
    for (const name of writes) {
      assert.equal(
        toolByName(name)?.annotations.readOnlyHint,
        false,
        `${name} writes and claims to be read only`,
      );
    }
  });

  it('mark nothing as destructive, because no tool deletes anything', () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(tool.annotations.openWorldHint, false);
    }
  });

  it('name the tools that run the audited system, and only those', () => {
    // Scanning and auditing read source and stored runs; they never start the system. Importing a
    // span file does not either. Only these four execute the audited process.
    const executing = TOOL_DEFINITIONS.filter((tool) => tool.executes).map((tool) => tool.name);
    assert.deepEqual(executing.slice().sort(), [
      'benchmark_variants',
      'inject_faults',
      'run_scenario',
      'run_traced',
    ]);
  });

  it('are all reachable: every advertised tool has a handler and every handler is advertised', () => {
    const advertised = TOOL_DEFINITIONS.map((tool) => tool.name).sort();
    assert.deepEqual(HANDLER_NAMES.slice().sort(), advertised);
  });

  it('are resolvable by name, and an unknown name resolves to nothing', () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(toolByName(tool.name)?.name, tool.name);
    }
    assert.equal(toolByName('no_such_tool'), undefined);
  });
});

describe('argument validation', () => {
  const schemaFor = (name: string) => {
    const tool = toolByName(name);
    assert.ok(tool !== undefined, `${name} is not advertised`);
    return tool.input;
  };

  it('accepts a call with only the optional fields omitted', () => {
    const result = validate(schemaFor('get_findings'), {});
    assert.equal(result.ok, true);
  });

  it('refuses a field the tool does not define', () => {
    const result = validate(schemaFor('get_findings'), { limit: 5, unknownOption: true });
    assert.equal(result.ok, false);
  });

  it('refuses a value of the wrong type and says which field', () => {
    const result = validate(schemaFor('get_findings'), { limit: 'ten' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.path.includes('limit')));
    }
  });

  it('bounds a page size so a caller cannot ask for an unbounded response', () => {
    assert.equal(validate(schemaFor('get_findings'), { limit: 1000 }).ok, false);
    assert.equal(validate(schemaFor('get_findings'), { limit: 100 }).ok, true);
  });

  it('requires the identifier a lookup needs', () => {
    assert.equal(validate(schemaFor('get_finding'), {}).ok, false);
    assert.equal(validate(schemaFor('get_finding'), { findingId: 'OSC-2026-0001' }).ok, true);
  });
});

const MAX_INSTRUCTION_CHARACTERS = 2000;

/**
 * The one thing an agent reads before it chooses a tool.
 *
 * It is prepended to a context window on every session, so it has to stay a front door rather than become a
 * manual, and every tool it names has to exist: a renamed tool leaves the entry point pointing at nothing,
 * and nothing else in this repository would notice.
 */
describe('the instructions a connecting agent is given', () => {
  it('names the entry point and the field that drives the rest', () => {
    assert.ok(
      SERVER_INSTRUCTIONS.includes('audit_agent_system'),
      'an agent is not told which tool begins the loop',
    );
    assert.ok(
      SERVER_INSTRUCTIONS.includes('loop.next.tool'),
      'an agent is not told what to follow after the first call',
    );
  });

  it('spells no tool name that does not exist', () => {
    const mentioned = SERVER_INSTRUCTIONS.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
    for (const name of mentioned) {
      assert.ok(
        toolByName(name) !== undefined,
        `the instructions name ${name}, which is not an advertised tool`,
      );
    }
  });

  it('stays short enough to be read rather than skimmed', () => {
    assert.ok(
      SERVER_INSTRUCTIONS.length <= MAX_INSTRUCTION_CHARACTERS,
      `the instructions are ${SERVER_INSTRUCTIONS.length} characters, past the ${MAX_INSTRUCTION_CHARACTERS} a front door gets`,
    );
  });
});

describe('the error contract', () => {
  it('classifies a refusal so a caller can tell policy from a mistake', () => {
    const policy = new OrchescopeError('POLICY_DENIED', 'refused');
    const mistake = new OrchescopeError('INVALID_ARGUMENT', 'wrong');
    assert.equal(policy.category, 'policy');
    assert.equal(mistake.category, 'user');
    assert.deepEqual(Object.keys(policy.toJSON()).sort(), [
      'category',
      'code',
      'detail',
      'message',
    ]);
  });
});
