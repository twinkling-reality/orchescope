import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { scenarioTemplate } from '../src/scenario-template.ts';
import { startCommandCandidates } from '../src/start-command-candidates.ts';

/**
 * Candidate start commands, read and never run.
 *
 * `orchescope trace` is the one argv in the loop a caller cannot execute, and the repository usually
 * declares the answer somewhere. What matters as much as finding it is that each candidate cites the file
 * and the line it came from, so a reader checks it rather than trusting it, and that none of them ever
 * becomes the value the parser reads.
 */

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const project = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-start-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
};

describe('start commands a repository declares', () => {
  it('reads npm scripts with the line each is declared on', () => {
    const root = project({
      'package.json': `{
  "name": "example",
  "scripts": {
    "build": "tsc",
    "start": "node src/main.js",
    "dev": "node --watch src/main.js"
  }
}
`,
    });
    assert.deepEqual(startCommandCandidates(root), [
      { command: 'npm run start', file: 'package.json', line: 5 },
      { command: 'npm run dev', file: 'package.json', line: 6 },
    ]);
  });

  it('reads a console entry point out of pyproject, and a Procfile line', () => {
    const root = project({
      'pyproject.toml': `[project]
name = "example"

[project.scripts]
run_crew = "example.main:run"

[tool.ruff]
line-length = 100
`,
      Procfile: 'web: gunicorn app:server\nworker: python worker.py\n',
    });
    assert.deepEqual(startCommandCandidates(root), [
      { command: 'run_crew', file: 'pyproject.toml', line: 5 },
      { command: 'gunicorn app:server', file: 'Procfile', line: 1 },
      { command: 'python worker.py', file: 'Procfile', line: 2 },
    ]);
  });

  /*
   * A manifest is free to write the whole object inline, and a name that only appears inside another
   * script's value is not a declaration of it.
   */
  it('finds a script declared inline, and does not mistake a mention inside a value for one', () => {
    const root = project({
      'package.json': `{
  "name": "example",
  "scripts": { "restart": "npm run start", "start": "node src/main.js" }
}
`,
    });
    assert.deepEqual(startCommandCandidates(root), [
      { command: 'npm run start', file: 'package.json', line: 3 },
    ]);
  });

  it('offers nothing where the repository declares nothing', () => {
    assert.deepEqual(startCommandCandidates(project({ 'README.md': '# example\n' })), []);
  });

  it('offers nothing out of a manifest it cannot parse', () => {
    assert.deepEqual(startCommandCandidates(project({ 'package.json': '{ "scripts": ' })), []);
  });

  /*
   * A declared command is repository text and may carry a credential inline. Redaction is never a guarantee,
   * which is one more reason these arrive as comments a person reads rather than as an argv.
   */
  it('redacts a secret a declared command carries', () => {
    const root = project({
      Procfile:
        'web: node main.js --token sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNNOOOOPPPPQQQQRRRRSSSSTTTT-UUUUVVVV\n',
    });
    const [candidate] = startCommandCandidates(root);
    assert.ok(candidate !== undefined);
    assert.equal(
      candidate.command.includes('sk-ant-api03'),
      false,
      `the token survived into the template: ${candidate.command}`,
    );
  });
});

describe('the scenario template carrying candidates', () => {
  it('offers each as a comment, with where it came from, above the placeholder', () => {
    const text = scenarioTemplate([{ command: 'npm run start', file: 'package.json', line: 5 }]);
    assert.ok(
      text.includes('  #   npm run start    (package.json:5)'),
      `the candidate is not in the template: ${text}`,
    );
    /*
     * The placeholder stays the value the parser reads. A candidate that became `target.command` would be
     * this build choosing a command to execute, which is the refusal the template exists to keep.
     */
    assert.ok(text.includes("  command: ['node', 'src/main.js']"));
    assert.equal(
      text.includes('\n  command: npm run start'),
      false,
      'a candidate became the command the runner would execute',
    );
  });

  it('says nothing at all where the repository declares no command', () => {
    assert.equal(scenarioTemplate().includes('Declared in this repository'), false);
  });
});
