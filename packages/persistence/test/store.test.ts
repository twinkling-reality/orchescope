import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { OrchescopeError } from '@orchescope/domain';
import { createArtifactStore } from '../src/artifacts.ts';
import { integrityCheck, openDatabase } from '../src/database.ts';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '../src/migrations.ts';

/**
 * Persistence tests.
 *
 * The properties under test are the ones that decide whether stored analysis can be trusted later: the version of the
 * schema is recorded and enforced, a future database is refused rather than read, artifacts are addressed by the hash
 * of their content, and files are created with permissions that do not expose a repository's contents.
 */

const directories: string[] = [];

const workspace = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-store-'));
  directories.push(root);
  return root;
};

after(() => {
  for (const root of directories) rmSync(root, { recursive: true, force: true });
});

describe('migrations', () => {
  it('are numbered from one without a gap and in order', () => {
    for (const [index, migration] of MIGRATIONS.entries()) {
      assert.equal(migration.version, index + 1, 'migration versions must be contiguous');
      assert.ok(migration.description.length > 0);
      assert.ok(migration.statements.length > 0);
    }
  });

  it('agree with the version the build claims to write', () => {
    assert.equal(LATEST_SCHEMA_VERSION, MIGRATIONS.at(-1)?.version);
  });

  it('declare every table STRICT, so a type mismatch fails at write time', () => {
    for (const migration of MIGRATIONS) {
      for (const statement of migration.statements) {
        if (statement.trimStart().toUpperCase().startsWith('CREATE TABLE')) {
          assert.match(
            statement,
            /STRICT/,
            `a table in migration ${migration.version} is not STRICT`,
          );
        }
      }
    }
  });
});

describe('openDatabase', () => {
  it('records the schema version it applied', () => {
    const database = openDatabase(join(workspace(), 'state/orchescope.db'));
    assert.equal(database.schemaVersion, LATEST_SCHEMA_VERSION);
    const row = database.get('PRAGMA user_version');
    assert.equal(Object.values(row ?? {})[0], LATEST_SCHEMA_VERSION);
    database.close();
  });

  it('is idempotent: reopening applies nothing and keeps the data', () => {
    const path = join(workspace(), 'state/orchescope.db');
    const first = openDatabase(path);
    first.run(
      'INSERT INTO project (id, name, path_hash, created_at) VALUES (?, ?, ?, ?)',
      'prj_1',
      'demo',
      'abc',
      '2026-07-24T00:00:00.000Z',
    );
    first.close();

    const second = openDatabase(path);
    assert.equal(second.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(second.all('SELECT id FROM project').length, 1);
    second.close();
  });

  it('refuses a database written by a newer build rather than reading it', () => {
    const path = join(workspace(), 'state/orchescope.db');
    const database = openDatabase(path);
    database.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 5}`);
    database.close();

    assert.throws(
      () => openDatabase(path),
      (error: unknown) =>
        error instanceof OrchescopeError && error.code === 'STORE_VERSION_UNSUPPORTED',
    );
  });

  it('reports a file that is not a database as corrupt, with a way out', () => {
    const path = join(workspace(), 'not-a-database.db');
    writeFileSync(path, 'this is not a database');
    assert.throws(
      () => openDatabase(path),
      (error: unknown) =>
        error instanceof OrchescopeError &&
        error.code === 'STORE_CORRUPT' &&
        (error.remediation ?? '').length > 0,
    );
  });

  it('enforces foreign keys, so a run cannot reference a project that does not exist', () => {
    const database = openDatabase(join(workspace(), 'state/orchescope.db'));
    assert.throws(() => {
      database.run(
        'INSERT INTO scan (id, project_id, graph_id, graph_digest, created_at, component_count, edge_count, git_dirty, orchescope_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'scan_1',
        'prj_missing',
        'graph_1',
        'a'.repeat(64),
        '2026-07-24T00:00:00.000Z',
        0,
        0,
        0,
        '0.1.0',
      );
    });
    database.close();
  });

  it('rolls a failed transaction back completely', () => {
    const database = openDatabase(join(workspace(), 'state/orchescope.db'));
    assert.throws(() => {
      database.transaction(() => {
        database.run(
          'INSERT INTO project (id, name, path_hash, created_at) VALUES (?, ?, ?, ?)',
          'prj_1',
          'demo',
          'abc',
          '2026-07-24T00:00:00.000Z',
        );
        throw new Error('the work failed after a write');
      });
    });
    assert.equal(database.all('SELECT id FROM project').length, 0);
    database.close();
  });

  it('joins a nested transaction to the outer one instead of committing early', () => {
    const database = openDatabase(join(workspace(), 'state/orchescope.db'));
    assert.throws(() => {
      database.transaction(() => {
        database.transaction(() => {
          database.run(
            'INSERT INTO project (id, name, path_hash, created_at) VALUES (?, ?, ?, ?)',
            'prj_nested',
            'demo',
            'abc',
            '2026-07-24T00:00:00.000Z',
          );
        });
        throw new Error('the outer work failed');
      });
    });
    assert.equal(database.all('SELECT id FROM project').length, 0);
    database.close();
  });

  it('reports integrity on a healthy database', () => {
    const database = openDatabase(join(workspace(), 'state/orchescope.db'));
    assert.deepEqual(integrityCheck(database), { ok: true, detail: 'ok' });
    database.close();
  });
});

describe('the artifact store', () => {
  const open = () => {
    const root = workspace();
    const database = openDatabase(join(root, 'state/orchescope.db'));
    const store = createArtifactStore(
      join(root, 'artifacts'),
      database,
      () => '2026-07-24T00:00:00.000Z',
    );
    return { root, database, store };
  };

  it('addresses content by its hash, so the same content is stored once', () => {
    const { database, store } = open();
    const first = store.putText('{"a":1}', 'application/json');
    const second = store.putText('{"a":1}', 'application/json');
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(database.all('SELECT digest FROM artifact').length, 1);
    database.close();
  });

  it('round trips json through the same addressing', () => {
    const { database, store } = open();
    const digest = store.putJson({ b: [1, 2, 3], a: 'x' });
    assert.deepEqual(store.getJson(digest), { b: [1, 2, 3], a: 'x' });
    assert.equal(store.has(digest), true);
    assert.equal(store.verify(digest), true);
    database.close();
  });

  it('reports a removed artifact as absent', () => {
    const { database, store } = open();
    const digest = store.putText('temporary', 'text/plain');
    store.remove(digest);
    assert.equal(store.has(digest), false);
    database.close();
  });

  it('returns exactly what was written', () => {
    const { database, store } = open();
    const content = 'a line\nand another\n';
    assert.equal(store.getText(store.putText(content, 'text/plain')), content);
    database.close();
  });

  it('reports a missing artifact as missing rather than as an unreadable file', () => {
    const { database, store } = open();
    assert.throws(
      () => store.getText('b'.repeat(64)),
      (error: unknown) => error instanceof OrchescopeError && error.code === 'ARTIFACT_MISSING',
    );
    database.close();
  });

  it('refuses a digest that is not a digest, which is what a path traversal looks like here', () => {
    const { database, store } = open();
    for (const bad of ['../../etc/passwd', 'a/b', '', 'zz'.repeat(32)]) {
      assert.throws(() => store.getText(bad), `${bad} was accepted as a digest`);
    }
    database.close();
  });

  it('creates its files and directories without group or world access', () => {
    const { root, database, store } = open();
    const digest = store.putText('secret enough', 'text/plain');
    const file = join(root, 'artifacts', digest.slice(0, 2), digest);
    assert.equal(statSync(file).mode & 0o077, 0);
    assert.equal(statSync(join(root, 'artifacts')).mode & 0o077, 0);
    assert.equal(readFileSync(file, 'utf8'), 'secret enough');
    database.close();
  });

  it('leaves no partial file behind after a successful write', () => {
    const { root, database, store } = open();
    const digest = store.putText('content', 'text/plain');
    assert.throws(() =>
      statSync(join(root, 'artifacts', digest.slice(0, 2), `${digest}.${process.pid}.partial`)),
    );
    database.close();
  });
});
