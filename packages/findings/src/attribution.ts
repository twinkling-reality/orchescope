import { normalizeLocalName } from '@orchescope/domain';
import type { IndexedGraph } from '@orchescope/graph';
import { entryPoints } from '@orchescope/graph';
import type { ComponentId } from '@orchescope/schema';

/**
 * Attribution helpers.
 *
 * A finding has to name what it is about. Experiment results are about the whole task, and a fault targets a component
 * by the name the running system reports rather than by an identifier, so both need resolving before a finding can be
 * stored. The alternative, allowing a finding with no subject, would mean a report full of claims nobody can act on.
 */

const MAX_TASK_COMPONENTS = 5;

/**
 * Components that stand for the task as a whole: declared entry points, then groups, then agents. A benchmark or a
 * chaos outcome is attributed to these, because that is what actually ran.
 */
export const taskLevelComponents = (graph: IndexedGraph): readonly ComponentId[] => {
  const roots = entryPoints(graph);
  if (roots.length > 0) return roots.slice(0, MAX_TASK_COMPONENTS).map((component) => component.id);
  const agents = [...graph.componentsOfKind('agent'), ...graph.componentsOfKind('agent_group')];
  return agents.slice(0, MAX_TASK_COMPONENTS).map((component) => component.id);
};

/**
 * Resolves a runtime reported name to a component. Matching is on the display name, the identity name and the last
 * path segment, which covers `demo-small` against `orchescope-demo/demo-small`.
 */
export const resolveByRuntimeName = (
  graph: IndexedGraph,
  name: string,
): ComponentId | undefined => {
  const wanted = normalizeLocalName(name);
  const bare = wanted.slice(wanted.lastIndexOf('/') + 1);
  const match = graph.graph.components.find((component) => {
    const local = component.identity.localName;
    const declared = normalizeLocalName(component.displayName);
    const runtime = component.metadata['runtimeName'];
    return (
      local === wanted ||
      declared === wanted ||
      local.slice(local.lastIndexOf('/') + 1) === bare ||
      (typeof runtime === 'string' && normalizeLocalName(runtime) === wanted)
    );
  });
  return match?.id;
};
