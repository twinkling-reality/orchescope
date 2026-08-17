import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

/**
 * What a retry states about itself, read from the source rather than from its silhouette.
 *
 * A field report against 0.3.0 filed ten shapes and this build got five of them wrong. Three infinite
 * retries were reported as bounded, which is the false positive that costs the most, because the rule
 * that would have caught them declines when it believes a ceiling exists. Two exponential backoffs were
 * reported as waits this build could not describe. Two real retries produced no relation at all.
 *
 * The table is asserted whole. Every previous defect here was a row that was silently missing or
 * silently wrong, and a test that checks one row at a time cannot see either.
 */

const traversal = {
  maxFileBytes: 512 * 1024,
  maxFiles: 500,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (build: (workspace: ReturnType<typeof createTempWorkspace>) => void) => {
  const workspace = createTempWorkspace('orchescope-retry-');
  workspaces.push(workspace);
  build(workspace);
  const clock = fixedClock(0);
  const handle = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'fixture',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal,
      concurrency: 4,
    });
  } finally {
    handle.dispose();
  }
};

type Retry = { readonly bounded: boolean; readonly backoff: string };

/** One line per discovered retry, keyed by the host it reaches so a missing row cannot hide. */
const retriesIn = (result: Awaited<ReturnType<typeof scan>>): readonly string[] =>
  result.graph.edges
    .filter((edge) => edge.policy?.retry !== undefined)
    .map((edge) => {
      const retry = edge.policy?.retry as Retry;
      return `${edge.to.replace('external_service:', '')} bounded=${retry.bounded} backoff=${retry.backoff}`;
    })
    .sort();

describe('the shapes a JavaScript retry is written in', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, { name: 'retry-shapes' });
    workspace.write(
      'src/shapes.js',
      `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const maxAttempts = 3;

export async function neverAdvances(body) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fetch('https://never-advances.example.com/v1/charges', { method: 'POST', body });
    } catch {
      await sleep(100);
    }
  }
}

export async function boundGrows(body) {
  let attempt = 0;
  let ceiling = 3;
  while (attempt < ceiling) {
    try {
      return await fetch('https://bound-grows.example.com/v1/charges', { method: 'POST', body });
    } catch {
      attempt += 1;
      ceiling += 1;
      await sleep(100);
    }
  }
}

export async function testIsAlwaysTrue(body) {
  for (let attempt = 0; true; attempt++) {
    try {
      return await fetch('https://always-true.example.com/v1/charges', { method: 'POST', body });
    } catch {
      await sleep(100);
    }
  }
}

export async function powBackoff(body) {
  let attempt = 0;
  while (attempt < 5) {
    try {
      return await fetch('https://pow.example.com/v1/charges', { method: 'POST', body });
    } catch {
      attempt += 1;
      await sleep(100 * Math.pow(2, attempt));
    }
  }
}

export async function mutatedBackoff(body) {
  let attempt = 0;
  let delayMs = 100;
  while (attempt < 5) {
    try {
      return await fetch('https://mutated.example.com/v1/charges', { method: 'POST', body });
    } catch {
      attempt += 1;
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

export async function counterNamedI(body) {
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch('https://counter-i.example.com/v1/charges', { method: 'POST', body });
    } catch {}
  }
}

export async function testsResponseOk(body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://response-ok.example.com/v1/charges', { method: 'POST', body });
    if (res.ok) return res;
    await sleep(100);
  }
}

export async function joinedHead(body) {
  let attempt = 0;
  let running = true;
  while (running && attempt < maxAttempts) {
    try {
      return await fetch('https://joined-head.example.com/v1/charges', { method: 'POST', body });
    } catch {
      attempt += 1;
      await sleep(100);
    }
  }
}

export async function counterAdvances(body) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fetch('https://advances.example.com/v1/charges', { method: 'POST', body });
    } catch {
      attempt += 1;
      await sleep(100);
    }
  }
}

export async function testsAFlag(body) {
  let done = false;
  while (!done) {
    try {
      done = true;
      return await fetch('https://flagged.example.com/v1/charges', { method: 'POST', body });
    } catch {
      await sleep(100);
    }
  }
}
`,
    );
  };

  /*
   * Read this against the fixture above. Every `bounded` here is whether the loop can end on its own,
   * which is not whether its head has a test in it, and every `backoff` is what the wait is written as.
   */
  const expected = [
    // The head names a maximum and nothing ever increments the counter.
    'never-advances.example.com bounded=false backoff=fixed',
    // The counter advances and the bound advances with it.
    'bound-grows.example.com bounded=false backoff=fixed',
    // A three part `for` with a test that is the literal `true`.
    'always-true.example.com bounded=false backoff=fixed',
    // A wait that exponentiates through the library spelling of the operator.
    'pow.example.com bounded=true backoff=exponential',
    // A wait that grows one statement away from the call that takes it.
    'mutated.example.com bounded=true backoff=exponential',
    // A counter the author called `i`, and no wait at all: found by the shape of a pass.
    'counter-i.example.com bounded=true backoff=none',
    // A pass that reads the response instead of catching, so there is no `try` to key off.
    'response-ok.example.com bounded=true backoff=fixed',
    // A flag joined to a counter: the `&&` ends the loop as soon as either side does.
    'joined-head.example.com bounded=true backoff=fixed',
    // The shape that was always read correctly, kept here so a fix cannot quietly lose it.
    'advances.example.com bounded=true backoff=fixed',
    // A flag states no ceiling, which was always right and stays right.
    'flagged.example.com bounded=false backoff=fixed',
  ].sort();

  it('classifies every one of them as the source states, with no row missing', async () => {
    assert.deepEqual(retriesIn(await scan(build)), expected);
  });
});

describe('the shapes a Python retry is written in', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'retry-shapes', dependencies: ['httpx'] });
    workspace.write(
      'src/shapes.py',
      `import time

import httpx

MAX_ATTEMPTS = 3


def never_advances(body):
    attempt = 0
    while attempt < MAX_ATTEMPTS:
        try:
            return httpx.post("https://never-advances.example.com/v1/charges", data=body)
        except Exception:
            time.sleep(1)


def bound_grows(body):
    attempt = 0
    ceiling = 3
    while attempt < ceiling:
        try:
            return httpx.post("https://bound-grows.example.com/v1/charges", data=body)
        except Exception:
            attempt += 1
            ceiling += 1
            time.sleep(1)


def joined_head(body):
    attempt = 0
    while True and attempt < MAX_ATTEMPTS:
        try:
            return httpx.post("https://joined-head.example.com/v1/charges", data=body)
        except Exception:
            attempt += 1
            time.sleep(1)


def mutated_backoff(body):
    attempt = 0
    delay = 1
    while attempt < MAX_ATTEMPTS:
        try:
            return httpx.post("https://mutated.example.com/v1/charges", data=body)
        except Exception:
            attempt += 1
            time.sleep(delay)
            delay *= 2


def counter_advances(body):
    attempt = 0
    while attempt < MAX_ATTEMPTS:
        try:
            return httpx.post("https://advances.example.com/v1/charges", data=body)
        except Exception:
            attempt += 1
            time.sleep(1)
`,
    );
  };

  const expected = [
    'never-advances.example.com bounded=false backoff=fixed',
    'bound-grows.example.com bounded=false backoff=fixed',
    // `while True and attempt < MAX_ATTEMPTS` is how one pinned repository writes a bounded poll.
    'joined-head.example.com bounded=true backoff=fixed',
    'mutated.example.com bounded=true backoff=exponential',
    'advances.example.com bounded=true backoff=fixed',
  ].sort();

  it('classifies every one of them as the source states, with no row missing', async () => {
    assert.deepEqual(retriesIn(await scan(build)), expected);
  });
});

/**
 * Evidence belongs to the function that showed it.
 *
 * Read per module, any `maxAttempts` anywhere in a file became attempt ceiling evidence for every retry
 * in it, so one bounded poll suppressed the finding for an infinite retry against a payment endpoint in
 * the same file. The rules were declining honestly and about the wrong function, and what a reader saw
 * was a status word and an empty findings array.
 */
describe('what one function showed', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, { name: 'two-functions' });
    workspace.write(
      'src/two.js',
      `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function boundedPoll() {
  const maxAttempts = 5;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fetch('https://status.example.com/v1/jobs');
    } catch {
      attempt += 1;
      await sleep(100);
    }
  }
}

export async function unboundedCharge(body) {
  while (true) {
    try {
      return await fetch('https://payments.example.com/v1/charges', { method: 'POST', body });
    } catch {
      await sleep(100);
    }
  }
}
`,
    );
  };

  it('is not read as evidence about a different function in the same file', async () => {
    const result = await scan(build);
    const charge = result.graph.edges.find(
      (edge) =>
        edge.policy?.retry !== undefined && edge.to === 'external_service:payments.example.com',
    );
    assert.ok(
      charge !== undefined,
      'the infinite retry against the payment endpoint was not found',
    );
    assert.equal(charge.policy?.retry?.bounded, false);
    assert.equal(
      charge.metadata['attemptCeiling'],
      undefined,
      'a maximum declared in an unrelated function was read as this one having a ceiling',
    );
  });

  it('is still read as evidence about the function that showed it', async () => {
    const result = await scan(build);
    const poll = result.graph.edges.find(
      (edge) =>
        edge.policy?.retry !== undefined && edge.to === 'external_service:status.example.com',
    );
    assert.equal(poll?.policy?.retry?.bounded, true);
    assert.match(String(poll?.metadata['attemptCeiling'] ?? ''), /maxAttempts/);
  });
});

/**
 * A component can stand for more than one call.
 *
 * A function that posts a job and then polls its status builds both addresses at run time, so both are
 * one component named for that function. Asking that component whether the polled read is safe to repeat
 * answered with the class of the POST, and the finding named a write the loop never makes.
 */
describe('a poll beside a post, in one function', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'parse-tool', dependencies: ['requests'] });
    workspace.write(
      'src/parse.py',
      `import time

import requests


def parse_document(base_url, file_path):
    submitted = requests.post(f"{base_url}/parse", files={"raw": file_path}, timeout=30)
    job_id = submitted.json()["job_id"]
    while True:
        status = requests.get(f"{base_url}/parse/jobs/{job_id}/status", timeout=30)
        if status.json()["state"] == "completed":
            break
        time.sleep(5)
`,
    );
  };

  it('records the class of the call the loop actually repeats', async () => {
    const result = await scan(build);
    const retried = result.graph.edges.filter((edge) => edge.policy?.retry !== undefined);
    assert.equal(retried.length, 1, 'the poll was not discovered');
    assert.equal(
      retried[0]?.metadata['retriedEffect'],
      'read_only',
      'the poll was described with the class of the POST beside it',
    );
  });

  /*
   * The component is one node for both requests, which is what makes the relation the only place the
   * poll can be described. Asserted so that a later change to the identity cannot make this test pass
   * for a reason it was not written for.
   */
  it('leaves both requests on one component, which cannot answer for either alone', async () => {
    const result = await scan(build);
    const service = result.graph.components.filter(
      (component) => component.kind === 'external_service',
    );
    assert.equal(service.length, 1);
    assert.equal(service[0]?.sourceLocations.length, 2);
    assert.notEqual(service[0]?.sideEffect, 'read_only');
  });
});

/**
 * The one place `declared` can be read.
 *
 * The schema says `idempotency: 'declared'` means a key was found on the retried operation, and only a
 * hand written manifest ever said it: all five sites that read source and construct a retry policy wrote
 * `'unknown'`. So the strength rule selecting on that value could report a repository that had written
 * the answer into its own manifest and never one that carries the key in the request it retries.
 */
describe('a retry around a request that carries an idempotency key', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, { name: 'keyed-retry' });
    workspace.write(
      'src/pay.js',
      `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chargeWithKey(amount, key) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch('https://payments.example.com/v1/charges', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: amount,
      });
    } catch {
      await sleep(100);
    }
  }
}

export async function chargeWithoutKey(amount) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch('https://billing.example.com/v1/charges', { method: 'POST', body: amount });
    } catch {
      await sleep(100);
    }
  }
}
`,
    );
  };

  const retryTo = async (host: string) => {
    const result = await scan(build);
    return result.graph.edges.find(
      (edge) => edge.policy?.retry !== undefined && edge.to === `external_service:${host}`,
    )?.policy?.retry;
  };

  it('is declared, because the key is on the request and not one frame away', async () => {
    assert.equal((await retryTo('payments.example.com'))?.idempotency, 'declared');
  });

  it('is unknown when the same request carries no key', async () => {
    assert.equal((await retryTo('billing.example.com'))?.idempotency, 'unknown');
  });

  /*
   * A named helper is handed the key and what it does with it is a frame this build has not read, so the
   * operation has not been shown to declare one. `declared` is a claim about the request that leaves the
   * process.
   */
  it('is unknown when the key is passed to a helper rather than to the request', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'delegated-key' });
      workspace.write(
        'src/pay.js',
        `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const postCharge = async (amount, options) =>
  fetch('https://payments.example.com/v1/charges', { method: 'POST', body: amount, ...options });

export async function chargeWithKey(amount, key) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await postCharge(amount, { headers: { 'Idempotency-Key': key } });
    } catch {
      await sleep(100);
    }
  }
}
`,
      );
    });
    const retried = result.graph.edges.filter((edge) => edge.policy?.retry !== undefined);
    assert.ok(retried.length > 0, 'the retry was not discovered at all');
    for (const edge of retried) assert.notEqual(edge.policy?.retry?.idempotency, 'declared');
  });
});
