import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OrchescopeError } from '@orchescope/domain';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations.ts';

/**
 * Database access.
 *
 * `node:sqlite` is a release candidate API, so it is confined to this file and the repositories that use
 * the small `Database` surface below. Replacing the driver is a change here and nowhere else.
 *
 * The bundled SQLite version differs between Node builds, so the features Orchescope depends on are checked
 * once at open time and reported as an environment error rather than failing later inside a query.
 */

export type Row = Record<string, unknown>;

export type Database = {
  readonly exec: (sql: string) => void;
  readonly run: (sql: string, ...parameters: readonly SqlValue[]) => void;
  readonly get: (sql: string, ...parameters: readonly SqlValue[]) => Row | undefined;
  readonly all: (sql: string, ...parameters: readonly SqlValue[]) => readonly Row[];
  readonly transaction: <T>(work: () => T) => T;
  readonly close: () => void;
  readonly sqliteVersion: string;
  readonly schemaVersion: number;
};

export type SqlValue = string | number | null | Uint8Array | bigint;

const REQUIRED_SQLITE_VERSION = [3, 44, 0] as const;

const compareVersion = (version: string): number => {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < REQUIRED_SQLITE_VERSION.length; index += 1) {
    const found = parts[index] ?? 0;
    const required = REQUIRED_SQLITE_VERSION[index] ?? 0;
    if (found !== required) return found - required;
  }
  return 0;
};

const readUserVersion = (database: DatabaseSync): number => {
  const row = database.prepare('PRAGMA user_version').get() as
    | { user_version?: number }
    | undefined;
  return typeof row?.user_version === 'number' ? row.user_version : 0;
};

const migrate = (database: DatabaseSync): number => {
  const current = readUserVersion(database);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new OrchescopeError(
      'STORE_VERSION_UNSUPPORTED',
      `The store is at schema version ${current} and this build understands ${LATEST_SCHEMA_VERSION}.`,
      {
        detail: { found: current, supported: LATEST_SCHEMA_VERSION },
        remediation: 'Upgrade Orchescope, or remove .orchescope/state to start a fresh store.',
      },
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    database.exec('BEGIN');
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new OrchescopeError('STORE_CORRUPT', `Migration ${migration.version} failed.`, {
        cause: error,
        detail: { version: migration.version, description: migration.description },
      });
    }
  }
  return readUserVersion(database);
};

export const openDatabase = (path: string): Database => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let handle: DatabaseSync;
  try {
    handle = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  } catch (error) {
    throw new OrchescopeError('STORE_CORRUPT', `The store at ${path} could not be opened.`, {
      cause: error,
      remediation:
        'Check the file permissions, or remove .orchescope/state to start a fresh store.',
    });
  }

  // Opening a handle does not read the file. A file that is not a database, or one that has been truncated, fails on
  // the first statement instead, so every step up to the migration is classified together rather than reaching the
  // caller as an unclassified driver error.
  let sqliteVersion: string;
  let schemaVersion: number;
  try {
    const versionRow = handle.prepare('SELECT sqlite_version() AS version').get() as
      | { version?: string }
      | undefined;
    sqliteVersion = versionRow?.version ?? '0.0.0';
    if (compareVersion(sqliteVersion) < 0) {
      throw new OrchescopeError(
        'UNSUPPORTED_PLATFORM',
        `This Node build bundles SQLite ${sqliteVersion} and Orchescope needs ${REQUIRED_SQLITE_VERSION.join('.')} or newer.`,
        { remediation: 'Upgrade Node.js to a build with a newer bundled SQLite.' },
      );
    }
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = NORMAL');
    handle.exec('PRAGMA busy_timeout = 5000');
    handle.exec('PRAGMA foreign_keys = ON');
    schemaVersion = migrate(handle);
  } catch (error) {
    handle.close();
    if (error instanceof OrchescopeError) throw error;
    throw new OrchescopeError('STORE_CORRUPT', `The store at ${path} could not be read.`, {
      cause: error,
      remediation:
        'Remove .orchescope/state to start a fresh store, keeping any exports you still need.',
    });
  }

  let depth = 0;

  return {
    exec: (sql) => handle.exec(sql),
    run: (sql, ...parameters) => {
      handle.prepare(sql).run(...parameters);
    },
    get: (sql, ...parameters) => handle.prepare(sql).get(...parameters) as Row | undefined,
    all: (sql, ...parameters) => handle.prepare(sql).all(...parameters) as readonly Row[],
    transaction: <T>(work: () => T): T => {
      // Nested calls join the outer transaction: SQLite has no nested transactions, and a savepoint
      // would silently change the failure semantics callers expect.
      if (depth > 0) return work();
      depth += 1;
      handle.exec('BEGIN');
      try {
        const result = work();
        handle.exec('COMMIT');
        return result;
      } catch (error) {
        handle.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close: () => handle.close(),
    sqliteVersion,
    schemaVersion,
  };
};

export const integrityCheck = (
  database: Database,
): { readonly ok: boolean; readonly detail: string } => {
  const row = database.get('PRAGMA integrity_check');
  const value = row === undefined ? undefined : Object.values(row)[0];
  const detail = typeof value === 'string' ? value : 'unknown';
  return { ok: detail === 'ok', detail };
};

export const asInteger = (value: boolean): number => (value ? 1 : 0);

export const asBoolean = (value: unknown): boolean => value === 1 || value === true;

export const asNullable = (value: string | undefined): string | null => value ?? null;
