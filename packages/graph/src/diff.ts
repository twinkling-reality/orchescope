import { canonicalJson, identityKey, isRenameOf } from '@orchescope/domain';
import type { Component, ComponentId, Edge, GraphDelta, SystemGraph } from '@orchescope/schema';

/**
 * Structural diff between two system graphs.
 *
 * Used by baseline versus candidate comparison. A component that moved file but kept its kind and
 * name is reported as a rename rather than as a removal plus an addition, because a reviewer reading
 * "two components disappeared" would draw the wrong conclusion.
 */

const componentChanges = (baseline: Component, candidate: Component): readonly string[] => {
  const changes: string[] = [];
  if (baseline.displayName !== candidate.displayName) {
    changes.push(`displayName ${baseline.displayName} to ${candidate.displayName}`);
  }
  if (canonicalJson(baseline.details ?? null) !== canonicalJson(candidate.details ?? null)) {
    changes.push('details changed');
  }
  if (baseline.sideEffect !== candidate.sideEffect) {
    changes.push(
      `side effect class ${baseline.sideEffect ?? 'unset'} to ${candidate.sideEffect ?? 'unset'}`,
    );
  }
  if (canonicalJson(baseline.permissions) !== canonicalJson(candidate.permissions)) {
    changes.push('permissions changed');
  }
  if (baseline.presence.runtime !== candidate.presence.runtime) {
    changes.push(
      candidate.presence.runtime ? 'now exercised at runtime' : 'no longer exercised at runtime',
    );
  }
  const baselineFiles = baseline.sourceLocations.map((location) => location.file).sort();
  const candidateFiles = candidate.sourceLocations.map((location) => location.file).sort();
  if (canonicalJson(baselineFiles) !== canonicalJson(candidateFiles)) {
    changes.push('source locations changed');
  }
  return changes;
};

const byIdentity = (graph: SystemGraph): Map<string, Component> =>
  new Map(graph.components.map((component) => [identityKey(component.identity), component]));

const edgeKey = (edge: Edge, components: ReadonlyMap<ComponentId, Component>): string => {
  const from = components.get(edge.from);
  const to = components.get(edge.to);
  return `${edge.kind}|${from === undefined ? edge.from : identityKey(from.identity)}|${
    to === undefined ? edge.to : identityKey(to.identity)
  }`;
};

export const diffGraphs = (baseline: SystemGraph, candidate: SystemGraph): GraphDelta => {
  const baselineComponents = byIdentity(baseline);
  const candidateComponents = byIdentity(candidate);

  const removedKeys = [...baselineComponents.keys()].filter((key) => !candidateComponents.has(key));
  const addedKeys = [...candidateComponents.keys()].filter((key) => !baselineComponents.has(key));

  const renamed: GraphDelta['renamedComponents'] = [];
  const consumedAdds = new Set<string>();
  const consumedRemoves = new Set<string>();

  for (const removedKey of removedKeys) {
    const removedComponent = baselineComponents.get(removedKey);
    if (removedComponent === undefined) continue;
    const match = addedKeys.find((addedKey) => {
      if (consumedAdds.has(addedKey)) return false;
      const addedComponent = candidateComponents.get(addedKey);
      return (
        addedComponent !== undefined &&
        isRenameOf(addedComponent.identity, removedComponent.identity)
      );
    });
    if (match === undefined) continue;
    const addedComponent = candidateComponents.get(match);
    if (addedComponent === undefined) continue;
    renamed.push({ from: removedComponent.id, to: addedComponent.id });
    consumedAdds.add(match);
    consumedRemoves.add(removedKey);
  }

  const changed: GraphDelta['changedComponents'] = [];
  for (const [key, candidateComponent] of candidateComponents) {
    const baselineComponent = baselineComponents.get(key);
    if (baselineComponent === undefined) continue;
    const changes = componentChanges(baselineComponent, candidateComponent);
    if (changes.length > 0)
      changed.push({ componentId: candidateComponent.id, changes: [...changes] });
  }

  const baselineById = new Map(baseline.components.map((component) => [component.id, component]));
  const candidateById = new Map(candidate.components.map((component) => [component.id, component]));
  const baselineEdges = new Map(baseline.edges.map((edge) => [edgeKey(edge, baselineById), edge]));
  const candidateEdges = new Map(
    candidate.edges.map((edge) => [edgeKey(edge, candidateById), edge]),
  );

  return {
    addedComponents: addedKeys
      .filter((key) => !consumedAdds.has(key))
      .map((key) => candidateComponents.get(key)?.id)
      .filter((id): id is ComponentId => id !== undefined),
    removedComponents: removedKeys
      .filter((key) => !consumedRemoves.has(key))
      .map((key) => baselineComponents.get(key)?.id)
      .filter((id): id is ComponentId => id !== undefined),
    renamedComponents: renamed,
    changedComponents: changed,
    addedEdges: [...candidateEdges]
      .filter(([key]) => !baselineEdges.has(key))
      .map(([, edge]) => edge.id),
    removedEdges: [...baselineEdges]
      .filter(([key]) => !candidateEdges.has(key))
      .map(([, edge]) => edge.id),
  };
};
