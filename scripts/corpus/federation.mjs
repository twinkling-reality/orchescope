/**
 * Exercises and measures one pinned multi-repository system through the public CLI.
 *
 * Repository roots are execution inputs only. The federation command scans each one separately and
 * accepts joins only from runtime source coordinates and independently propagated parent context.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { exerciseRepository } from './exercise.mjs';

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const run = (command, arguments_, options = {}) =>
  execFileSync(command, arguments_, {
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

const parseDocument = (text, subject) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${subject} wrote no JSON document`);
  }
};

const componentReference = (reference) => ({
  repositoryUrl: reference.repositoryUrl,
  revision: reference.revision,
  componentId: reference.componentId,
});

const stableRefusal = (refusal) => ({
  scope: refusal.scope,
  reason: refusal.reason,
  ...(refusal.attribute === undefined ? {} : { attribute: refusal.attribute }),
  count: refusal.count,
  samples: refusal.samples.map(({ runId: _runId, ...sample }) => sample),
});

const observationOf = (system, exercise, data) => ({
  name: system.name,
  repositories: data.repositories
    .map((repository) => ({
      repositoryUrl: repository.repositoryUrl,
      revision: repository.revision,
      components: repository.components,
      relations: repository.relations,
    }))
    .sort((left, right) => left.repositoryUrl.localeCompare(right.repositoryUrl)),
  runtime: {
    runs: exercise.runs,
    spans: exercise.spans,
    services: exercise.services,
  },
  componentJoins: data.componentJoins
    .map((join_) => ({
      component: componentReference(join_.component),
      observedKind: join_.observedKind,
      observedName: join_.observedName,
      rule: join_.rule,
    }))
    .sort((left, right) => {
      const leftKey = `${left.component.repositoryUrl}|${left.component.componentId}`;
      const rightKey = `${right.component.repositoryUrl}|${right.component.componentId}`;
      return leftKey.localeCompare(rightKey);
    }),
  relations: data.relations
    .map((relation) => ({
      kind: relation.kind,
      from: componentReference(relation.from),
      to: componentReference(relation.to),
      executions: relation.executions,
    }))
    .sort((left, right) => {
      const leftKey = `${left.kind}|${left.from.repositoryUrl}|${left.from.componentId}|${left.to.repositoryUrl}|${left.to.componentId}`;
      const rightKey = `${right.kind}|${right.from.repositoryUrl}|${right.from.componentId}|${right.to.repositoryUrl}|${right.to.componentId}`;
      return leftKey.localeCompare(rightKey);
    }),
  coverage: {
    repositoriesSupplied: data.coverage.repositoriesSupplied,
    eligibleRepositories: data.coverage.eligibleRepositories,
    observedComponents: data.coverage.observedComponents,
    joinedComponents: data.coverage.joinedComponents,
    observedRelations: data.coverage.observedRelations,
    withinRepositoryRelations: data.coverage.withinRepositoryRelations,
    joinedCrossRepositoryRelations: data.coverage.joinedCrossRepositoryRelations,
    sourceIdentity: data.coverage.sourceIdentity,
    refusals: data.coverage.refusals.map(stableRefusal),
  },
});

export const exerciseFederatedSystem = (root, system, repositoryDirectories, environment) => {
  const runtimeIndex = system.repositories.findIndex(
    (repository) => repository.name === system.exercise.runtimeRepository,
  );
  const runtimeDirectory = repositoryDirectories[runtimeIndex];
  if (runtimeDirectory === undefined) {
    throw new Error(`${system.name} has no runtime repository checkout`);
  }
  const additionalCheckouts = repositoryDirectories.filter((_, index) => index !== runtimeIndex);
  const exercised = exerciseRepository(
    root,
    system,
    runtimeDirectory,
    environment,
    additionalCheckouts,
  );

  const arguments_ = [join(root, 'apps/cli/src/main.ts'), '--cwd', runtimeDirectory, 'federate'];
  for (const directory of repositoryDirectories) {
    arguments_.push('--repository', directory);
  }
  arguments_.push('--runs', '1', '--json');

  let output;
  try {
    output = run('node', arguments_, {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (error) {
    const document = parseDocument(String(error.stdout ?? ''), `the federation of ${system.name}`);
    throw new Error(
      `the federation of ${system.name} failed: ${document.error?.message ?? String(error.stderr ?? error.message).trim()}`,
    );
  }
  const document = parseDocument(output, `the federation of ${system.name}`);
  if (document.ok !== true) {
    throw new Error(
      `the federation of ${system.name} failed: ${document.error?.message ?? 'no message'}`,
    );
  }
  return observationOf(system, exercised, document.data);
};

export const describeFederation = (observation) => [
  `${observation.name}  federated system, ${observation.repositories.length} repositories, ${observation.relations.length} cross-repository relation(s)`,
  `  runtime       ${observation.runtime.spans} span(s) from ${observation.runtime.services.length} service(s)`,
  `  joins         ${observation.componentJoins.length} component(s), ${observation.coverage.joinedCrossRepositoryRelations} cross-repository relation(s)`,
  `  refusals      ${observation.coverage.refusals.reduce((total, refusal) => total + refusal.count, 0)} observed item(s) refused`,
];
