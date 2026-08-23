import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Component, McpServerDetails } from '@orchescope/schema';
import { establishesAgentSystem, partOfAuditedSystem } from '../src/audited-system.ts';

const server = (role?: McpServerDetails['role']): Component =>
  ({
    kind: 'mcp_server',
    ...(role === undefined ? {} : { details: { for: 'mcp_server', role } }),
  }) as Component;

describe('an MCP server and the system its repository implements', () => {
  it('lets an agent-framework workflow establish the system without calling its steps agents', () => {
    const workflow = { kind: 'workflow' } as Component;
    const step = { kind: 'workflow_step' } as Component;
    assert.equal(establishesAgentSystem(workflow), true);
    assert.equal(establishesAgentSystem(step), false);
  });

  it('keeps a consumed server in the audited topology without letting it establish detection', () => {
    const consumed = server('consumed');
    assert.equal(partOfAuditedSystem(consumed), true);
    assert.equal(establishesAgentSystem(consumed), false);
  });

  it('lets an implemented server establish detection', () => {
    const implemented = server('implemented');
    assert.equal(partOfAuditedSystem(implemented), true);
    assert.equal(establishesAgentSystem(implemented), true);
  });

  it('preserves the unqualified server meaning used by version 1 manifests', () => {
    assert.equal(establishesAgentSystem(server()), true);
  });

  it('keeps developer tooling out of both populations', () => {
    const tooling = server('developer_tooling');
    assert.equal(partOfAuditedSystem(tooling), false);
    assert.equal(establishesAgentSystem(tooling), false);
  });
});
