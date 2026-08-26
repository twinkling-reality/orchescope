import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

/**
 * Model Context Protocol recognition, asked about the protocol rather than about the publisher.
 *
 * The reader was gated on three distribution names in two places: whether it ran at all, and which
 * constructions it recognised. A repository built on a fourth SDK failed both. Both now ask the
 * specification instead, and what remains of the list is the ownership claim, which is the one role
 * [ADR 0015](../../../docs/architecture/adr/0015-the-asymmetric-invariant.md) permits a name.
 *
 * The limit is stated in the same breath, because it is the point of the record. The specification defines
 * a wire format and no source-level API, so a server's source says nothing about which protocol it serves
 * except through the protocol's own name in the symbol and the specification's capability nouns in what is
 * registered on it. Both are here and neither is a vendor name.
 */

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-mcp-protocol-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'mcp-protocol-fixture',
      orchescopeVersion: '0.9.2',
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
  }
};

const mcpRun = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.coverage.adapters.find((run) => run.adapterId === 'adapter:mcp');

const servers = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components.filter((component) => component.kind === 'mcp_server');

describe('whether this repository shows the protocol', () => {
  /*
   * FALSIFIER. `workflows-acp` drives sessions through `mcp_use`, which is on no list and does not match
   * `mcp` under `moduleMatches` because a Python distribution normalised from a hyphen is not a sub-path of
   * another one. Under the old gate the reader never ran on a repository shaped like this.
   */
  it('runs on a repository whose only evidence is a call spelling a specification method', async () => {
    const result = await scan({
      'src/wrapper.py': `from some_other_sdk.client import Session

session = Session()

async def run(tool_name, tool_input):
    return await session.call_tool(name=tool_name, arguments=tool_input)
`,
    });

    assert.equal(
      mcpRun(result)?.status,
      'completed',
      'a call carrying the specification method and that method own params is the protocol, whoever published the library it came from',
    );
  });

  /*
   * GUARD. The method word set alone names `pydantic-ai` own `self._call_tool` a hundred and twenty one
   * times across the corpus. The published params are what make the test a test.
   */
  it('stays away from a method spelled the same way and carrying none of its params', async () => {
    const result = await scan({
      'src/executor.py': `from some_other_sdk.runner import Runner

runner = Runner()

def execute(result):
    return runner.call_tool(result)
`,
    });

    assert.equal(mcpRun(result)?.status, 'not_applicable');
  });

  /*
   * GUARD, and it is here because the first form of this gate did not hold it. The specification defines an
   * HTTP server entry of `{url, headers}`, and that is what every HTTP client in every language takes. The
   * corpus caught it: `axios` became a repository that shows the Model Context Protocol, at
   * `lib/core/Axios.js:278 mergeConfig` and five more sites, and so did `langgraph` at
   * `libs/langgraph/langgraph/pregel/remote.py:174 get_client`. What makes that object a server entry is the
   * `mcpServers` key it sits under, which the configuration half reads and this half cannot see.
   */
  it('stays away from an object shaped like every HTTP request ever made', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/client.js': `import { request } from 'some-http-kit';

export const fetchIt = () => request({ url: 'https://example.test/v1', headers: { accept: 'json' } });
`,
    });

    assert.equal(mcpRun(result)?.status, 'not_applicable');
  });

  /* FALSIFIER. A server declared in source rather than in a configuration document is the same declaration. */
  it('runs where a launched server is declared in source', async () => {
    const result = await scan({
      'src/hosts.py': `from some_other_sdk import connect

connect({"command": "npx", "args": ["-y", "server-filesystem"], "env": {"HOME": "/tmp"}})
`,
    });

    assert.equal(mcpRun(result)?.status, 'completed');
  });
});

describe('a server this repository implements', () => {
  /*
   * FALSIFIER. The distribution is on no list and the symbol is not one of the three the reader used to
   * match, so the old gate saw nothing here at all.
   */
  it('is recognised from an unlisted distribution when the protocol is registered on it', async () => {
    const result = await scan({
      'src/server.py': `from some_vendor_kit import McpServerBase

server = McpServerBase("inventory")

@server.tool(name="lookup", description="Look an item up")
def lookup(sku: str) -> str:
    return sku
`,
    });

    assert.equal(servers(result).length, 1);
    assert.equal(servers(result)[0]?.identity.localName, 'inventory');
  });

  /*
   * FALSIFIER, in the tightening direction. `new Server({name, version})` from a listed distribution was a
   * server because the symbol and the distribution were both on a list. `{name, version}` is package
   * metadata and says nothing about a protocol, and nothing is registered on this value, so the source does
   * not support the claim. Measured over the corpus this loses exactly one site, a `FastMCP` in
   * `pydantic-ai` whose bound value carries no registration in its module.
   */
  it('is not recognised from a listed distribution when nothing is registered on it', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/app.js': `import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export const server = new Server({ name: 'quiet', version: '1.0.0' });
`,
    });

    assert.deepEqual(servers(result), []);
  });

  /*
   * GUARD. The protocol name in a symbol is one word and it is the protocol own, but it is not sufficient
   * on its own: without the registration the same test names every error and capability type an SDK
   * exports. Measured: a hundred and thirty nine such sites against twenty one real servers.
   */
  it('is not recognised from a type that merely carries the protocol name', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/app.js': `import { McpError } from 'some-vendor-kit/types.js';

export const failure = new McpError('bad request');
`,
    });

    assert.deepEqual(servers(result), []);
  });

  /* GUARD. A client is the other role, and reading one as a server invents a component. */
  it('is not recognised from the client half of the protocol', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/app.js': `import { McpClient } from 'some-vendor-kit/client.js';

const client = new McpClient({ name: 'reader', version: '1.0.0' });

export const tools = () => client.listTools();
`,
    });

    assert.deepEqual(servers(result), []);
  });
});
