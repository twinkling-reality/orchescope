/**
 * The shapes that have fooled this build, injected into every pinned repository that is not an agent system.
 *
 * A recorded expectation says what one scan of one repository produced, and a reviewer decides whether a
 * number that moved is a fix or a regression. That is the wrong instrument for a precision failure, because
 * a precision failure arrives as a repository nobody pinned: the `.mcp.json` one was found by a sweep across
 * thirty odd real repositories and the `agents.yaml` one by two fixtures written by hand, and no entry in
 * this corpus held either shape. What is pinned here instead is the invariant. A document that has fooled
 * this build is written into a repository that is not an agent system, and the repository has to stay one.
 *
 * The table is the failure log, and it lives in `packages/testkit` because the discovery tests cross the
 * same rows with a repository they build themselves. Adding a shape is one row and it applies to every
 * negative and every reader at once, so this grows with what has gone wrong rather than with the number of
 * readers, and it covers readers that do not exist yet.
 *
 * Every injection is measured against the base scan of the same repository, and the two scans have to differ
 * somewhere. A shape a `.gitignore` swallowed, or a traversal never walked, would otherwise pass every
 * assertion below by not being there, which is this file's own failure mode wearing the costume of a pass.
 * The comparison is the corpus harness's own, so a shape that arrives as one more discovered file and a
 * shape that arrives as a reader refusing a document are both answered without a rule per row: what proves
 * `.orchescope/manifest.yaml` arrived is the manifest adapter reporting it, because the traversal never
 * walks that directory and the file count does not move.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AGENT_SYSTEM_KINDS } from '../../packages/domain/src/audited-system.ts';
import { LOOKALIKE_CONFIGURATIONS } from '../../packages/testkit/src/lookalike-configuration.ts';
import { auditRepository, clearStoredState } from './audit.mjs';
import { differences } from './comparison.mjs';
import { observationOf } from './observation.mjs';

/** Every path written is resolved and checked against the checkout, never assembled and trusted. */
const pathInside = (directory, file) => {
  const target = resolve(directory, file);
  if (target !== join(directory, file)) {
    throw new Error(`${file} does not resolve to a path inside ${directory}`);
  }
  return target;
};

/**
 * Writes one shape into a checkout, remembering only the directories it had to create.
 *
 * A checkout is reused by the next injection, by the next entry and by the next run, so what is written has
 * to be gone before anything else is measured, and a directory the repository already had is not this
 * file's to remove. `wx` is the guard on the other side: a repository that comes to hold one of these paths
 * fails loudly here instead of having it silently overwritten and restored as an empty space.
 */
const write = (directory, injection) => {
  const target = pathInside(directory, injection.file);
  const missing = [];
  for (let parent = dirname(target); parent !== directory; parent = dirname(parent)) {
    if (!existsSync(parent)) missing.unshift(parent);
  }
  for (const parent of missing) mkdirSync(parent);
  writeFileSync(target, injection.contents, { flag: 'wx', mode: 0o644 });
  return { target, created: [...missing].reverse() };
};

const remove = (written) => {
  rmSync(written.target, { force: true });
  for (const created of written.created) rmSync(created, { recursive: true, force: true });
};

/**
 * What one injected shape did to one repository, as the list of invariants it broke.
 *
 * An empty list is the shape held. Nothing here records a number, so there is no expectation to rewrite and
 * no diff for a reviewer to wave through.
 */
const verdict = (injection, base, observation, bundle) => {
  const broken = [];
  if (differences(base, observation).length === 0) {
    broken.push(
      `the scan is identical to the one without it, so the injected ${injection.file} never reached a reader`,
    );
  }
  if (observation.agentSystemDetected !== false) {
    broken.push('the repository was reported as an agent system');
  }
  const declared = bundle.graph.components.filter((component) =>
    AGENT_SYSTEM_KINDS.has(component.kind),
  );
  for (const component of declared) {
    if (component.details?.role === 'developer_tooling') continue;
    broken.push(`${component.id} is an agent system component and says nothing about whose it is`);
  }
  if (injection.outcome === 'declines' && declared.length > 0) {
    broken.push(
      `this shape is meant to be declined and it declared ${declared.map((component) => component.id).join(', ')}`,
    );
  }
  if (injection.outcome === 'developer_tooling' && declared.length === 0) {
    broken.push('this shape is meant to be read as developer tooling and nothing read it');
  }
  return broken;
};

/**
 * Runs the whole table against one repository that is not an agent system.
 *
 * The base observation is passed in rather than measured again: the entry has just been scanned, and a
 * second scan of the same checkout is the same numbers at the cost of another parse.
 */
export const injectionVerdicts = (root, entry, directory, base) => {
  const results = [];
  for (const injection of LOOKALIKE_CONFIGURATIONS) {
    const written = write(directory, injection);
    try {
      clearStoredState(directory);
      const { audit, bundle } = auditRepository(
        root,
        `${entry.name}-injected-${injection.name}`,
        directory,
      );
      results.push({
        injection: injection.name,
        file: injection.file,
        broken: verdict(injection, base, observationOf(entry, audit, bundle, undefined), bundle),
      });
    } catch (error) {
      results.push({
        injection: injection.name,
        file: injection.file,
        broken: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      remove(written);
      clearStoredState(directory);
    }
  }
  return results;
};
