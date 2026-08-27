import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The call site a run reports, through the real command line, against a repository built for it.
 *
 * The producer decides that a frame belongs to the repository by asking whether the repository tracks
 * the file, and this is the case that separates that from every cheaper rule. The dependency here lives
 * under the repository root, so containment accepts it; it is ignored, so the index does not. A run that
 * reported the dependency's file would be naming a location no declaration was ever read from, and it
 * would do so confidently.
 *
 * Everything is built rather than fixtured: a git repository with a commit, an ignored dependency, and a
 * server on loopback that answers the request the dependency makes.
 */

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = join(repositoryRoot, 'apps/cli/src/main.ts');

const git = (cwd: string, ...args: readonly string[]): void => {
  execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
};

const runCli = async (cwd: string, args: readonly string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, '--cwd', cwd, ...args], {
      cwd: repositoryRoot,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
    });
    return stdout;
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? '';
  }
};

describe('the source location a traced run reports', () => {
  let root = '';
  let server: Server | undefined;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'orchescope-source-frame-'));
    const port = await new Promise<number>((settle) => {
      const listener = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
      server = listener;
      listener.listen(0, '127.0.0.1', () => {
        settle((listener.address() as { port: number }).port);
      });
    });

    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'fakesdk'), { recursive: true });

    // The dependency: under the repository root, and ignored, so only the index can tell them apart.
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n.orchescope/\n');
    writeFileSync(
      join(root, 'node_modules', 'fakesdk', 'package.json'),
      '{"name":"fakesdk","type":"module","exports":{".":"./index.mjs"}}\n',
    );
    writeFileSync(
      join(root, 'node_modules', 'fakesdk', 'index.mjs'),
      [
        'const send = (url, model) =>',
        '  fetch(url, { method: "POST", body: JSON.stringify({ model }) });',
        'const layer = (url, model) => send(url, model);',
        'export const createCompletion = (url, model) => layer(url, model);',
        '',
      ].join('\n'),
    );

    // The repository's own source, three frames above the transport once the SDK is crossed.
    writeFileSync(
      join(root, 'src', 'orchestrator.mjs'),
      [
        "import { createCompletion } from 'fakesdk';",
        'export const askTheModel = async (url) => {',
        // The repository names the model it calls, which is what a manifest can cite.
        "  const model = 'demo-small';",
        '  const answer = await createCompletion(url, model);',
        '  return answer.status;',
        '};',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'src', 'main.mjs'),
      [
        "import { askTheModel } from './orchestrator.mjs';",
        `const status = await askTheModel('http://127.0.0.1:${port}/v1/chat/completions');`,
        'process.stdout.write(`answered ${status}`);',
        '',
      ].join('\n'),
    );
    writeFileSync(join(root, 'package.json'), '{"name":"traced-target","type":"module"}\n');

    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'target@example.test');
    git(root, 'config', 'user.name', 'target');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'the target');
  });

  after(() => {
    server?.close();
    if (root.length > 0) rmSync(root, { recursive: true, force: true });
  });

  it('names the repository file that made the call, not the dependency that sent it', async () => {
    await runCli(root, ['init']);
    const traced = await runCli(root, ['trace', '--', 'node', 'src/main.mjs']);
    assert.match(traced, /answered 200/, 'the target did not reach the server it was pointed at');

    const captured = readCapturedAttributes(root);
    assert.ok(
      captured.length > 0,
      'the traced run carried no source location at all, so nothing was captured',
    );
    const [first] = captured;
    assert.ok(first !== undefined);

    assert.equal(
      first['orchescope.code.repository.path'],
      'src/orchestrator.mjs',
      `the frame reported is not the repository's own call site: ${JSON.stringify(first)}`,
    );
    assert.equal(first['orchescope.code.audit.path'], 'src/orchestrator.mjs');
    assert.equal(first['code.function.name'], 'askTheModel');
    assert.equal(first['code.line.number'], 4);
    assert.equal(first['orchescope.source.capture'], 'node.callsite.tracked_file');
    assert.match(String(first['code.file.path'] ?? ''), /\/src\/orchestrator\.mjs$/);
    assert.match(String(first['orchescope.code.file.digest'] ?? ''), /^[0-9a-f]{64}$/);

    // The tree is clean and has no remote, so there is no pin to report and none is invented.
    assert.equal(first['vcs.ref.head.revision'], undefined);
    assert.equal(first['vcs.repository.url.full'], undefined);
  });

  /*
   * The join this whole producer exists for, on a repository that cannot be pinned.
   *
   * There is no remote here and so no immutable coordinate to report, which is the ordinary state of a
   * tree somebody works in. What the run can still say is which file it called from and what that file
   * contained, and the scan recorded the same digest for the same path, so the two halves are talking
   * about the same bytes and can say so without either of them naming a framework.
   */
  it('joins the declaration by the digest of the file, with no pin on either side', async () => {
    const declared = join(root, 'src', 'orchestrator.mjs');
    const digest = createHash('sha256').update(readFileSync(declared)).digest('hex');
    mkdirSync(join(root, '.orchescope'), { recursive: true });
    writeFileSync(
      join(root, '.orchescope', 'manifest.yaml'),
      [
        'schemaVersion: 3',
        'components:',
        '  - kind: model',
        '    name: demo-small',
        '    definedIn: src/orchestrator.mjs',
        '    definedAtLine: 3',
        `    definedFileHash: ${digest}`,
        'edges: []',
        '',
      ].join('\n'),
    );

    const audited = JSON.parse(await runCli(root, ['audit', '--json'])) as {
      data: {
        reconciliation: {
          joins: { byCodeLocation: number; byKindAndName: number; onNameAlone: string[] };
          coverage: { missingSpanAttributes: { attribute: string; reason?: string }[] };
        };
      };
    };
    const { joins, coverage } = audited.data.reconciliation;

    assert.equal(
      joins.byCodeLocation,
      1,
      `the location did not decide the join: ${JSON.stringify(joins)}`,
    );
    assert.equal(joins.byKindAndName, 0);
    assert.deepEqual(joins.onNameAlone, []);

    const refusals = coverage.missingSpanAttributes.map(
      (entry) => `${entry.attribute}:${entry.reason ?? ''}`,
    );
    // The pin is absent and said to be absent, rather than quietly stood in for.
    assert.ok(refusals.includes('vcs.ref.head.revision:missing'), JSON.stringify(refusals));
    assert.ok(refusals.includes('vcs.repository.url.full:missing'), JSON.stringify(refusals));
    /*
     * The run reports the line it called from and the manifest cites the line that names the model, so
     * the two differ by construction. The join holds on the file, the kind and the name, and the part
     * that did not corroborate is still reported.
     */
    assert.ok(
      refusals.includes('code.line.number:line_outside_declaration'),
      JSON.stringify(refusals),
    );
  });

  /* The digest is doing the work, which is only true if changing the file refuses the join. */
  it('refuses the location when the file on disk is not the file the run read', async () => {
    const source = join(root, 'src', 'orchestrator.mjs');
    const original = readFileSync(source, 'utf8');
    writeFileSync(source, `${original}\n// edited after the run\n`);
    try {
      const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
      writeFileSync(
        join(root, '.orchescope', 'manifest.yaml'),
        [
          'schemaVersion: 3',
          'components:',
          '  - kind: model',
          '    name: demo-small',
          '    definedIn: src/orchestrator.mjs',
          '    definedAtLine: 3',
          `    definedFileHash: ${digest}`,
          'edges: []',
          '',
        ].join('\n'),
      );

      const audited = JSON.parse(await runCli(root, ['audit', '--json'])) as {
        data: {
          reconciliation: {
            joins: { byCodeLocation: number; byKindAndName: number };
            coverage: { missingSpanAttributes: { attribute: string; reason?: string }[] };
          };
        };
      };
      const { joins, coverage } = audited.data.reconciliation;
      assert.equal(joins.byCodeLocation, 0, 'a changed file still decided the join by location');
      const refusals = coverage.missingSpanAttributes.map(
        (entry) => `${entry.attribute}:${entry.reason ?? ''}`,
      );
      assert.ok(
        refusals.includes('orchescope.code.file.digest:digest_mismatch'),
        `the changed file was not reported: ${JSON.stringify(refusals)}`,
      );
    } finally {
      writeFileSync(source, original);
    }
  });
});

/** Span attributes as the receiver stored them, read from the workspace this run wrote. */
const readCapturedAttributes = (root: string): Record<string, unknown>[] => {
  const database = new DatabaseSync(join(root, '.orchescope/state/orchescope.db'), {
    readOnly: true,
  });
  const rows = database
    .prepare("select json from span where json like '%orchescope.source.capture%'")
    .all() as { json: string }[];
  return rows.map(
    (row) => (JSON.parse(row.json) as { attributes: Record<string, unknown> }).attributes,
  );
};
