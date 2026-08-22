import type { SourceLocation } from '@orchescope/schema';
import type { ArgumentFact, CalleeOrigin, ModuleFacts } from '@orchescope/source-analysis';
import { calleeName, findEntry, objectArgument, stringValue } from '@orchescope/source-analysis';
import { moduleMatches } from './matching.ts';

/**
 * The node a LangGraph node routes to from inside its own implementation.
 *
 * `add_edge` states a relation between two names and `add_conditional_edges` states the set a router may
 * pick from. A node can state it from inside instead by returning
 * `Command(goto="write_research_brief")`, and the
 * destination is a string literal naming another node of the same graph, which is the same kind of
 * declaration `add_edge` makes and in the same words.
 *
 * Read without this, the pinned `open_deep_research` application declares nine nodes and exactly one
 * relation between two of them, which is the single `add_edge` its file contains. Seven of the eight
 * relations that file declares between its own nodes are written as `Command`, so the declared graph was a
 * set of nodes with almost nothing between them, and every question that reads the declared shape answered
 * against that: reachability, entry points, cycles and the coordination fan out.
 *
 * `Command(goto=...)` is independent evidence from a router return annotation. This reader handles the
 * command destination; the LangGraph adapter separately joins named-router annotations and returns, keeps
 * both locations, and marks disagreement incomplete rather than deciding which source statement wins.
 *
 * **A destination is read only where the same module declared a node of that name.** `goto=END` contributes
 * terminal boundary evidence without minting an application relation. A computed name or unsupported fan
 * out becomes a source-located refusal rather than a guessed relation.
 *
 * **A node whose implementation is written inline is not read, and that is a stated limit rather than a
 * silent one.** `addNode("plan", async () => new Command({ goto: "research" }))` declares the node and its
 * implementation in one expression, and the fact model reduces a function argument to the fact that it is a
 * function, so nothing connects the command inside it to the node it implements. That is how `langgraphjs`
 * writes its own examples, which is why this reading finds nothing there and ten relations in an
 * application: an application registers a function it named.
 */

const COMMAND = 'Command';
const DESTINATION = 'goto';
const COMMAND_PACKAGES = ['langgraph', '@langchain/langgraph'] as const;

/** A route one node's implementation declares to another, ready to become a relation. */
export type DeclaredRoute = {
  readonly from: string;
  readonly to: string;
  readonly location: SourceLocation;
  readonly symbol: string;
};

export type UnresolvedDeclaredRoute = {
  readonly reason: string;
  readonly location: SourceLocation;
};

export type DeclaredRouteBoundary = {
  readonly kind: 'terminal';
  readonly location: SourceLocation;
};

export type DeclaredRoutes = {
  readonly routes: readonly DeclaredRoute[];
  readonly boundaries: readonly DeclaredRouteBoundary[];
  readonly unresolved: readonly UnresolvedDeclaredRoute[];
};

/**
 * `langgraph.types` in Python and `@langchain/langgraph` in JavaScript, which is where each ecosystem's
 * `Command` comes from. Asked because a module that imports LangGraph is free to have a `Command` of its
 * own, and a class named after a common noun is the one most likely to collide.
 */
const isLangGraphCommand = (origin: CalleeOrigin | undefined): boolean => {
  if (origin === undefined || origin.imported !== COMMAND) return false;
  const module = origin.module;
  return (
    module === 'langgraph' ||
    module.startsWith('langgraph.') ||
    module === '@langchain/langgraph' ||
    module.startsWith('@langchain/langgraph/')
  );
};

const terminalSentinel = (
  module: ModuleFacts,
  value: ArgumentFact | undefined,
): '__end__' | undefined => {
  if (value?.kind === 'string') return value.value === '__end__' ? '__end__' : undefined;
  const path = value?.kind === 'member' ? value.path : undefined;
  const root = value?.kind === 'identifier' ? value.name : path?.[0];
  if (root === undefined) return undefined;
  if (
    module.definitions.some(
      (definition) => definition.enclosing === undefined && definition.name === root,
    )
  ) {
    return undefined;
  }
  const binding = module.imports.find(
    (entry) =>
      !entry.isType && entry.local === root && moduleMatches(entry.module, COMMAND_PACKAGES),
  );
  if (value?.kind === 'identifier') return binding?.imported === 'END' ? '__end__' : undefined;
  const last = path?.[path.length - 1];
  return last === 'END' && binding?.imported === '*' ? '__end__' : undefined;
};

/**
 * Every route the module's node implementations declare.
 *
 * `implementations` maps the name of a function to the node it was registered as, which is what turns a
 * call's enclosing function into one end of a relation. `Command` names everything by keyword in both
 * ecosystems, `Command(goto=...)` in Python and `new Command({ goto: ... })` in JavaScript, and the fact
 * model gives both the same shape, so the destination is read out of the first argument either way.
 */
export const routesDeclaredInNodes = (
  module: ModuleFacts,
  implementations: ReadonlyMap<string, string>,
  declaredNodes: ReadonlySet<string>,
): DeclaredRoutes => {
  const routes: DeclaredRoute[] = [];
  const boundaries: DeclaredRouteBoundary[] = [];
  const unresolved: UnresolvedDeclaredRoute[] = [];
  for (const call of module.calls) {
    if (calleeName(call) !== COMMAND || !isLangGraphCommand(call.origin)) continue;
    const from = call.enclosing === undefined ? undefined : implementations.get(call.enclosing);
    if (from === undefined || !declaredNodes.has(from)) {
      unresolved.push({
        reason: 'A LangGraph Command was not inside a named local node implementation.',
        location: call.location,
      });
      continue;
    }
    const destination = findEntry(objectArgument(call), DESTINATION);
    const value = destination?.value;
    const to = stringValue(value) ?? terminalSentinel(module, value);
    if (destination === undefined || to === undefined) {
      unresolved.push({
        reason: 'A LangGraph Command destination was computed rather than written as a literal.',
        location: destination?.location ?? call.location,
      });
      continue;
    }
    if (to === '__end__') {
      boundaries.push({ kind: 'terminal', location: destination.location });
      continue;
    }
    if (!declaredNodes.has(to)) {
      unresolved.push({
        reason: `A LangGraph Command names destination ${to}, which is not a declared node in this module.`,
        location: destination.location,
      });
      continue;
    }
    routes.push({
      from,
      to,
      location: destination.location,
      symbol: `${COMMAND}(${DESTINATION}="${to}")`,
    });
  }
  return { routes, boundaries, unresolved };
};
