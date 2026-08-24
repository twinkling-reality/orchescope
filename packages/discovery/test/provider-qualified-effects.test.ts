import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject } from '@orchescope/testkit';
import { effectsAdapter } from '../src/adapters/effects.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const workspace = () => {
  const created = createTempWorkspace('orchescope-provider-effects-');
  workspaces.push(created);
  writeNodeProject(created, {
    name: 'provider-effects',
    dependencies: {
      pg: '^8.0.0',
      redis: '^5.0.0',
      bullmq: '^5.0.0',
      mongodb: '^6.0.0',
      '@prisma/client': '^6.0.0',
      '@aws-sdk/client-sqs': '^3.0.0',
    },
  });
  return created;
};

const scan = async (created: ReturnType<typeof workspace>) => {
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: created.root,
      projectName: 'fixture',
      orchescopeVersion: '0.9.0',
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
      adapters: [effectsAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

const component = (result: Awaited<ReturnType<typeof scan>>, kind: string, name: string) =>
  result.graph.components.find(
    (candidate) => candidate.kind === kind && candidate.identity.localName === name,
  );

describe('provider-qualified datastore identity', () => {
  it('preserves direct, renamed, namespace, default-member and Pool Postgres constructions', async () => {
    const created = workspace();
    created.write(
      'src/postgres.ts',
      `import { Client, Pool, Client as PgClient } from 'pg';
import * as pg from 'pg';
import pgDefault from 'pg';

new Client();
new Pool();
new PgClient();
new pg.Client();
new pgDefault.Pool();
`,
    );
    const result = await scan(created);
    const postgres = component(result, 'database', 'postgres');
    assert.ok(postgres, 'the exact pg provider was not discovered');
    assert.deepEqual(
      postgres.sourceLocations.map((entry) => entry.startLine),
      [5, 6, 7, 8, 9],
    );
  });

  it('keeps httpx generic HTTP and never promotes its Client to Postgres', async () => {
    const created = workspace();
    created.write(
      'src/postgres.ts',
      `import { Client as PgClient } from 'pg';
export const database = new PgClient();
`,
    );
    created.write(
      'src/http_calls.py',
      `import httpx
from httpx import Client as HttpClient

direct = httpx.Client()
aliased = HttpClient()

def fetch_page():
    return aliased.get("https://example.com/page")
`,
    );
    const result = await scan(created);
    const postgres = component(result, 'database', 'postgres');
    assert.deepEqual(
      postgres?.sourceLocations.map((entry) => entry.file),
      ['src/postgres.ts'],
    );
    assert.ok(component(result, 'external_service', 'example.com'));
  });

  it('rejects direct and module aliases from httpx, local and type-only Client definitions, and missing origin', async () => {
    const created = workspace();
    created.write(
      'src/lookalikes.py',
      `import httpx as hx
from httpx import Client as ImportedClient

hx.Client()
ImportedClient()

class Client:
    pass

Client()
MissingClient = Client
`,
    );
    created.write(
      'src/type-only.ts',
      `import type { Client } from 'pg';
new Client();
`,
    );
    created.write('src/missing.ts', `new Client();\n`);
    created.write(
      'src/default-direct.ts',
      `import PgAlias from 'pg';
new PgAlias();
`,
    );
    const result = await scan(created);
    assert.equal(component(result, 'database', 'postgres'), undefined);
  });

  it('is invariant to the order of unrelated provider calls', async () => {
    const scanOrder = async (ordered: readonly string[]) => {
      const created = workspace();
      created.write(
        'src/effects.ts',
        `import { Client } from 'pg';
import { createClient } from 'redis';

${ordered.join('\n\n')}
`,
      );
      const result = await scan(created);
      return {
        components: result.graph.components.map((entry) => entry.id).sort(),
        edges: result.graph.edges.map((entry) => `${entry.kind}:${entry.from}->${entry.to}`).sort(),
      };
    };
    const pg = `export function openPostgres() { return new Client(); }`;
    const redis = `export function openRedis() { return createClient(); }`;
    assert.deepEqual(await scanOrder([pg, redis]), await scanOrder([redis, pg]));
  });
});

describe('provider-qualified datastore and queue families', () => {
  it('preserves the supported genuine providers with exact source origins', async () => {
    const created = workspace();
    created.write(
      'src/providers.ts',
      `import { createClient as createRedis } from 'redis';
import { Queue as BullQueue, Worker, FlowProducer } from 'bullmq';
import { MongoClient } from 'mongodb';
import { PrismaClient } from '@prisma/client';
import { DatabaseSync } from 'node:sqlite';
import { SQSClient } from '@aws-sdk/client-sqs';

createRedis();
new BullQueue('jobs');
new Worker('jobs', async () => undefined);
new FlowProducer();
new MongoClient('mongodb://localhost');
new PrismaClient();
new DatabaseSync(':memory:');
new SQSClient({});
`,
    );
    created.write(
      'src/providers.py',
      `import sqlite3
from pymongo import MongoClient as PyMongo
from sqlalchemy import create_engine as engine
from sqlalchemy.orm import sessionmaker
from celery import Celery

sqlite3.connect(":memory:")
PyMongo("mongodb://localhost")
engine("sqlite://")
sessionmaker()
Celery("tasks")
`,
    );
    const result = await scan(created);
    for (const name of ['redis', 'mongodb', 'prisma', 'sqlite', 'sqlalchemy']) {
      assert.ok(component(result, 'database', name), `missing database ${name}`);
    }
    for (const name of ['jobs', 'bullmq', 'tasks', 'sqs']) {
      assert.ok(component(result, 'queue', name), `missing queue ${name}`);
    }
    assert.ok(
      result.graph.edges.some(
        (edge) => edge.kind === 'consumes_from_queue' && edge.to.endsWith(':jobs'),
      ),
    );
  });

  it('rejects asyncio Queue, worker_threads Worker, and local provider lookalikes', async () => {
    const created = workspace();
    created.write(
      'src/lookalikes.py',
      `import asyncio
from queue import Queue as ThreadQueue

asyncio.Queue()
ThreadQueue()

class Queue:
    pass

Queue()
`,
    );
    created.write(
      'src/lookalikes.ts',
      `import { Worker as ThreadWorker } from 'node:worker_threads';
import { createClient as localClient } from './local-client.ts';

function createClient() { return {}; }
class Queue {}

new ThreadWorker('./task.js');
localClient();
createClient();
new Queue();
`,
    );
    created.write('src/local-client.ts', `export const createClient = () => ({});\n`);
    const result = await scan(created);
    assert.equal(
      result.graph.components.some((entry) => entry.kind === 'database'),
      false,
    );
    assert.equal(
      result.graph.components.some((entry) => entry.kind === 'queue'),
      false,
    );
  });
});

describe('source-settled datastore permissions', () => {
  it('reads an exact Python SQLite URI boundary as read-only', async () => {
    const created = workspace();
    created.write(
      'src/read_only.py',
      `import sqlite3

def open_read_only(path: str):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
`,
    );
    const result = await scan(created);
    assert.deepEqual(component(result, 'database', 'sqlite')?.permissions, [
      { kind: 'database', scope: 'sqlite', mode: 'read' },
    ]);
  });

  it('does not treat a URI-shaped filename as read-only when URI handling is absent', async () => {
    const created = workspace();
    created.write(
      'src/filename.py',
      `import sqlite3

sqlite3.connect("file:records.db?mode=ro")
`,
    );
    const result = await scan(created);
    assert.deepEqual(component(result, 'database', 'sqlite')?.permissions, [
      { kind: 'database', scope: 'sqlite', mode: 'write' },
    ]);
  });

  it('reads the exact Node SQLite constructor option and preserves the writable default', async () => {
    const readOnly = workspace();
    readOnly.write(
      'src/read-only.ts',
      `import { DatabaseSync } from 'node:sqlite';
new DatabaseSync('records.db', { readOnly: true });
`,
    );
    const readOnlyResult = await scan(readOnly);
    assert.deepEqual(component(readOnlyResult, 'database', 'sqlite')?.permissions, [
      { kind: 'database', scope: 'sqlite', mode: 'read' },
    ]);

    const writable = workspace();
    writable.write(
      'src/writable.ts',
      `import { DatabaseSync } from 'node:sqlite';
new DatabaseSync('records.db');
`,
    );
    const writableResult = await scan(writable);
    assert.deepEqual(component(writableResult, 'database', 'sqlite')?.permissions, [
      { kind: 'database', scope: 'sqlite', mode: 'write' },
    ]);
  });
});
