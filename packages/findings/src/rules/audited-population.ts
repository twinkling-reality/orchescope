import { agree, formatCount, partOfAuditedSystem } from '@orchescope/domain';
import type { IndexedGraph } from '@orchescope/graph';
import type { Component, ComponentKind, Edge, EdgeKind } from '@orchescope/schema';

/**
 * The population a rule about the system under audit reads.
 *
 * A rule asks one of two questions and they have different populations. "What did this scan find" is about
 * the graph and counts everything in it, which is what the coverage block and the human headline report.
 * "What is wrong with this system" is about the software the repository ships, and a component only a test
 * declares is not part of that: the test suite is written by whoever works on the repository, nothing the
 * repository ships exercises it, and reporting it costs the reader their own answer. `pydantic-ai` declares
 * 502 tools and 483 of them are in `tests/`; `openai-agents-python` reported 228 tools with no caller and
 * 214 of those were fixtures.
 *
 * Both halves stay in the graph and `coverage.componentsDeclaredInTest` says how many were set aside, so a
 * population smaller than the graph is a stated difference rather than a silent one.
 *
 * A relation is read the same way and asks one thing more. It is part of the system when the relation is
 * itself declared outside a test and both components it joins are, because a relation is only as audited as
 * the things at its ends: a fixture calling a real tool is still a fixture calling it.
 */

export const auditedComponents = (graph: IndexedGraph): readonly Component[] =>
  graph.graph.components.filter(partOfAuditedSystem);

export const auditedComponentsOfKind = (
  graph: IndexedGraph,
  kind: ComponentKind,
): readonly Component[] => graph.componentsOfKind(kind).filter(partOfAuditedSystem);

export const withinAuditedSystem = (graph: IndexedGraph, edge: Edge): boolean => {
  if (edge.declaredInTest === true) return false;
  const from = graph.component(edge.from);
  const to = graph.component(edge.to);
  return (
    from !== undefined && to !== undefined && partOfAuditedSystem(from) && partOfAuditedSystem(to)
  );
};

export const auditedEdges = (graph: IndexedGraph): readonly Edge[] =>
  graph.graph.edges.filter((edge) => withinAuditedSystem(graph, edge));

export const auditedEdgesOfKind = (graph: IndexedGraph, kind: EdgeKind): readonly Edge[] =>
  graph.edgesOfKind(kind).filter((edge) => withinAuditedSystem(graph, edge));

/** How many of a population a test file declares, counted rather than inferred from a difference. */
export const declaredInTestCount = (
  population: readonly { readonly declaredInTest?: true }[],
): number => population.filter((item) => item.declaredInTest === true).length;

/**
 * Why a population that a scan found came out empty once it was narrowed to the system under audit.
 *
 * A rule that looked at nothing has to say whether the repository declares nothing or whether everything
 * it declares was set aside, because those send a reader to opposite places. It also has to say which
 * reason, and it may not guess: the first sentence written here read `all.length - audited.length` as a
 * count of fixtures, and on `gpt-researcher` the one source it declines over is an MCP server named in a
 * `.mcp.json` for somebody's editor, with no source location at all. The count blamed a test file for an
 * exclusion a test file had nothing to do with. So the cause is claimed only where the fixtures account
 * for the whole emptiness, and otherwise the sentence says what is certain.
 *
 * The noun is the rule's, because a sentence written from the outside pluralises what it was handed and a
 * rule knows what it counted. The clause is shared so that the rules declining this way agree on what
 * they are saying, and a reader who has seen it on one reads it the same on the next.
 */
export const narrowedAway = (
  discovered: readonly { readonly declaredInTest?: true }[],
  noun: string,
): string | undefined => {
  if (discovered.length === 0) return undefined;
  const counted = formatCount(discovered.length, noun);
  const verb = agree(discovered.length, 'was', 'were');
  const inTests = declaredInTestCount(discovered);
  if (inTests === discovered.length) {
    return `${counted} ${verb} discovered and a test file declares every one of them`;
  }
  if (inTests > 0) {
    return `${counted} ${verb} discovered and none belongs to the system under audit, ${inTests} of them because a test file declares them`;
  }
  return `${counted} ${verb} discovered and none belongs to the system under audit`;
};
