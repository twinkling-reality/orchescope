import type { EdgeKind } from '@orchescope/schema';

/**
 * The relation a call produces, chosen by what the call reaches.
 *
 * There is no generic `depends_on` in this schema, so every call site has to name the review question
 * it answers. Shared rather than repeated at each call site because two adapters drawing the same
 * relation under two kinds is a graph a reader cannot query: `calls_tool` and `calls_service` between
 * the same pair read as two different facts about one call.
 *
 * A scope discovery invented to hold an effect is reached as a service, which is what the frame stands
 * in for. What it actually performs is a question for the graph, not for the kind of this relation.
 *
 * The kind arrives as the string a component identity carries rather than as `ComponentKind`, because
 * an identity is what an adapter holds at the moment it draws the relation.
 */
export const callRelationKind = (targetKind: string): EdgeKind => {
  if (targetKind === 'tool') return 'calls_tool';
  if (targetKind === 'database') return 'queries_database';
  if (targetKind === 'retrieval') return 'queries_retrieval';
  if (targetKind === 'model') return 'invokes_model';
  return 'calls_service';
};
