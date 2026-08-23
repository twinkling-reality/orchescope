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

export async function nestedCleanup(body) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      const response = await fetch('https://nested-cleanup.example.com/v1/traces', { method: 'POST', body });
      if (response.ok) break;
      if (response.status === 400) {
        try {
          cleanupResponse();
        } catch {}
        break;
      }
    } catch {}
    attempts += 1;
    await sleep(100);
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
    // An inner cleanup try cannot hide the outer guarded attempt that exits on success.
    'nested-cleanup.example.com bounded=true backoff=fixed',
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


def retryable_response():
    for attempt in range(MAX_ATTEMPTS):
        response = httpx.get("https://retryable-response.example.com/v1/search")
        if response.status_code >= 500 and attempt < MAX_ATTEMPTS - 1:
            time.sleep(1)
            continue
        return response


def oauth_pending(payload):
    attempts = 0
    while attempts < MAX_ATTEMPTS:
        response = httpx.post("https://oauth-pending.example.com/token", data=payload)
        if response.status_code == 200:
            return response
        if response.json()["error"] not in ("authorization_pending", "slow_down"):
            raise RuntimeError("authorization failed")
        time.sleep(1)
        attempts += 1


def conditional_failure_exit():
    retry_count = 0
    while retry_count <= MAX_ATTEMPTS:
        try:
            return httpx.get("https://conditional-failure.example.com/v1/search")
        except Exception as error:
            retry_count += 1
            if "Ratelimit" not in str(error):
                break
            time.sleep(1)


def status_poll_with_error_retry():
    for pass_number in range(MAX_ATTEMPTS):
        try:
            response = httpx.get("https://mixed-status.example.com/v1/status")
            if response.json()["state"] == "success":
                return response
            if response.json()["state"] == "failed":
                return response
        except Exception:
            if pass_number == MAX_ATTEMPTS - 1:
                return None
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
    // A counted range names attempts and branches explicitly on a retryable response.
    'retryable-response.example.com bounded=true backoff=fixed',
    // One failure class exits, while the rate-limit branch still re-attempts the guarded request.
    'conditional-failure.example.com bounded=true backoff=fixed',
    // Expected-state polling also retries a caught request failure until the bounded final pass.
    'mixed-status.example.com bounded=true backoff=fixed',
  ].sort();

  it('classifies every one of them as the source states, with no row missing', async () => {
    const retries = retriesIn(await scan(build));
    assert.deepEqual(retries, expected);
    assert.ok(
      !retries.some((retry) => retry.startsWith('oauth-pending.example.com ')),
      'an expected-pending OAuth poll is not an ambiguous-failure retry',
    );
  });
});

/**
 * A retry a library declares rather than one the code shapes.
 *
 * Everything above reads a retry from its shape: same work each pass, a counter, a wait. Tenacity states
 * the policy in its arguments and neither form it documents has a shape to read. `async for attempt in
 * AsyncRetrying(...)` is syntactically an iteration over an object, so each pass looked like it took the
 * next item, and `@retry(...)` is no loop at all. A retrieval application wrapping fifteen attempts
 * around a model call had all three retry rules report that no retry had been examined.
 *
 * The table is asserted whole, for the reason the tables above are: every defect here was a row that was
 * silently missing or silently wrong.
 */
describe('a retry tenacity declares', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'declared-retry', dependencies: ['httpx', 'tenacity'] });
    workspace.write(
      'src/declared.py',
      `import httpx
from tenacity import (
    AsyncRetrying,
    retry,
    stop_after_attempt,
    stop_never,
    wait_fixed,
    wait_random_exponential,
)


async def iterated(body):
    async for attempt in AsyncRetrying(
        wait=wait_random_exponential(min=15, max=60),
        stop=stop_after_attempt(15),
    ):
        with attempt:
            return httpx.post("https://iterated.example.com/v1/charges", data=body)


@retry(stop=stop_after_attempt(max_attempt_number=3), wait=wait_fixed(2))
def decorated(body):
    return httpx.post("https://decorated.example.com/v1/charges", data=body)


@retry
def bare(body):
    return httpx.post("https://bare.example.com/v1/charges", data=body)


async def never_stops(body):
    async for attempt in AsyncRetrying(stop=stop_never, wait=wait_fixed(1)):
        with attempt:
            return httpx.post("https://never-stops.example.com/v1/charges", data=body)


def not_a_retry(rows):
    for row in rows:
        httpx.post("https://iteration.example.com/v1/rows", data=row)
`,
    );
  };

  /*
   * Two of these are tenacity's documented defaults and both are the dangerous answer: no `stop` retries
   * forever, and no `wait` re-attempts as fast as the dependency can fail. They are read as facts about
   * the code rather than as gaps in this reading, because that is what the library says they mean.
   */
  const expected = [
    'iterated.example.com bounded=true backoff=exponential attempts=15',
    'decorated.example.com bounded=true backoff=fixed attempts=3',
    'bare.example.com bounded=false backoff=none attempts=none',
    'never-stops.example.com bounded=false backoff=fixed attempts=none',
  ].sort();

  it('reads the ceiling and the wait each form states, with no row missing', async () => {
    const result = await scan(build);
    const rows = result.graph.edges
      .filter((edge) => edge.policy?.retry !== undefined)
      .map((edge) => {
        const retry = edge.policy?.retry as Retry & { maxAttempts?: number };
        return `${edge.to.replace('external_service:', '')} bounded=${retry.bounded} backoff=${retry.backoff} attempts=${retry.maxAttempts ?? 'none'}`;
      })
      .sort();
    assert.deepEqual(rows, expected);
  });

  it('leaves a plain iteration alone in a module that does use tenacity', async () => {
    const result = await scan(build);
    const iteration = result.graph.edges.find((edge) => edge.to.includes('iteration.example.com'));
    assert.ok(iteration !== undefined, 'the request itself should still be discovered');
    assert.equal(iteration.policy?.retry, undefined);
  });

  it('says which declaration it read, so a rule can name it', async () => {
    const result = await scan(build);
    const declared = result.graph.edges.find((edge) => edge.to.includes('iterated.example.com'));
    assert.equal(declared?.metadata['retryDeclaration'], "a loop over tenacity's AsyncRetrying");
    const decorated = result.graph.edges.find((edge) => edge.to.includes('decorated.example.com'));
    assert.equal(
      decorated?.metadata['retryDeclaration'],
      "a function decorated with tenacity's retry",
    );
  });
});

/**
 * `retry` is a word, and only tenacity's means this.
 *
 * The decorator carries no shape to check, so the only thing separating a retry policy from any other
 * decorator called `retry` is where it came from. A module that never imports tenacity is not declaring
 * a tenacity retry however it spells its decorators.
 */
describe('a decorator called retry that is not tenacity', () => {
  it('declares nothing', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'other-retry', dependencies: ['httpx'] });
      workspace.write(
        'src/other.py',
        `import httpx
from retrying import retry


@retry
def send(body):
    return httpx.post("https://other.example.com/v1/charges", data=body)
`,
      );
    });
    const edge = result.graph.edges.find((entry) => entry.to.includes('other.example.com'));
    assert.ok(edge !== undefined, 'the request itself should still be discovered');
    assert.equal(edge.policy?.retry, undefined);
  });
});

/**
 * The retried operation, when the thing being retried is a model call.
 *
 * The index of what each call site produced is documented as complete and the model SDK adapter had
 * never written to it, so a retry around `client.embeddings.create(...)` resolved to nothing: the callee
 * is a method path no binding stands for. The loop was read, the operation was not, and no relation was
 * drawn at all.
 */
describe('a declared retry around a model call', () => {
  it('reaches the model, which is what makes the retry visible to a rule', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'retried-model',
        dependencies: ['openai', 'tenacity'],
      });
      workspace.write(
        'src/embed.py',
        `from openai import AsyncOpenAI
from tenacity import AsyncRetrying, stop_after_attempt, wait_random_exponential

client = AsyncOpenAI()


async def compute_embedding(text):
    async for attempt in AsyncRetrying(
        wait=wait_random_exponential(min=15, max=60),
        stop=stop_after_attempt(15),
    ):
        with attempt:
            return await client.embeddings.create(model="text-embedding-3-large", input=text)
`,
      );
    });
    const edge = result.graph.edges.find(
      (entry) => entry.policy?.retry !== undefined && entry.to.startsWith('model:'),
    );
    assert.ok(
      edge !== undefined,
      `no retry reached a model, among ${result.graph.edges.map((entry) => `${entry.kind}:${entry.to}`).join(', ')}`,
    );
    assert.equal(edge.policy?.retry?.maxAttempts, 15);
    assert.equal(edge.policy?.retry?.backoff, 'exponential');
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
 * A component can stand for more than one call, and a poll is not an ambiguous-failure retry.
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

  it('does not attach retry semantics to status polling', async () => {
    const result = await scan(build);
    const retried = result.graph.edges.filter((edge) => edge.policy?.retry !== undefined);
    assert.deepEqual(retried, []);
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

describe('polling and explicit non-success loops are not ambiguous-failure retries', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'polling-boundaries', dependencies: ['requests'] });
    workspace.write(
      'src/polling.py',
      `import time

import requests


def telegram(api, load_offset, save_offset):
    offset = load_offset()
    while True:
        try:
            updates = api("getUpdates", {"offset": offset})
            for update in updates:
                offset = update["update_id"] + 1
                save_offset(offset)
                api("sendMessage", {"chat_id": update["chat_id"], "text": "received"})
        except Exception:
            time.sleep(2)


def oauth(device_code):
    while True:
        response = requests.post(
            "https://auth.example.com/oauth/token",
            data={"device_code": device_code},
        )
        if response.status_code == 200:
            return response.json()
        if response.json().get("error") != "authorization_pending":
            raise RuntimeError("authorization failed")
        time.sleep(5)


def pair():
    for _ in range(30):
        response = requests.post("https://device.example.com/api/user", json={"name": "home"})
        if response.status_code == 200:
            return response.json()
        time.sleep(1)
    raise RuntimeError("pairing window expired")
`,
    );
  };

  it('does not attach retry policy to offset commits, OAuth polling, or bounded pairing', async () => {
    const result = await scan(build);
    const retries = result.graph.edges.filter((edge) => edge.policy?.retry !== undefined);
    assert.deepEqual(
      retries.map((edge) => ({ to: edge.to, locations: edge.sourceLocations })),
      [],
    );
  });
});
