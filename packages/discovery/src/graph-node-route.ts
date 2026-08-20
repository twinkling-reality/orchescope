import type { SourceLocation } from '@orchescope/schema';
import type { CalleeOrigin, ModuleFacts } from '@orchescope/source-analysis';
import { calleeName, findEntry, objectArgument, stringValue } from '@orchescope/source-analysis';

/**
 * The node a LangGraph node routes to from inside its own implementation.
 *
 * A graph used to be wired entirely from outside its nodes, and this build reads that: `add_edge` states a
 * relation between two names and `add_conditional_edges` states the set a router may pick from. The modern
 * idiom states it from inside instead. A node returns `Command(goto="write_research_brief")`, and the
 * destination is a string literal naming another node of the same graph, which is the same kind of
 * declaration `add_edge` makes and in the same words.
 *
 * Read without this, the pinned `open_deep_research` application declares nine nodes and exactly one
 * relation between two of them, which is the single `add_edge` its file contains. Seven of the eight
 * relations that file declares between its own nodes are written as `Command`, so the declared graph was a
 * set of nodes with almost nothing between them, and every question that reads the declared shape answered
 * against that: reachability, entry points, cycles and the coordination fan out.
 *
 * **The route is read from the call rather than from the return annotation.** LangGraph documents both, and
 * a node that returns a command is usually annotated `-> Command[Literal["a", "b"]]` so that the library
 * can draw the graph. The annotation is the fuller statement, and it is the one this fact model does not
 * carry: a return type is not a call, an argument or a definition, so reading it would mean teaching two
 * language parsers a new fact before an adapter could ask for it. The call sites say where the node
 * actually sends control, and where the two disagree the call is the one a reader can check by running it.
 *
 * **A destination is read only where the same module declared a node of that name.** `Command` also carries
 * `goto=END`, a `Send` for a fan out, and a name computed at run time. None of those is a literal naming a
 * declared node, so none of them becomes a relation, and the sentinel needs no special case: `__end__` is
 * never a declared node because `add_node` rejects the name.
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

/** A route one node's implementation declares to another, ready to become a relation. */
export type DeclaredRoute = {
  readonly from: string;
  readonly to: string;
  readonly location: SourceLocation;
  readonly symbol: string;
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
): readonly DeclaredRoute[] => {
  const routes: DeclaredRoute[] = [];
  for (const call of module.calls) {
    if (calleeName(call) !== COMMAND || !isLangGraphCommand(call.origin)) continue;
    const from = call.enclosing === undefined ? undefined : implementations.get(call.enclosing);
    if (from === undefined || !declaredNodes.has(from)) continue;
    const destination = findEntry(objectArgument(call), DESTINATION);
    const to = stringValue(destination?.value);
    if (destination === undefined || to === undefined || !declaredNodes.has(to)) continue;
    routes.push({
      from,
      to,
      location: destination.location,
      symbol: `${COMMAND}(${DESTINATION}="${to}")`,
    });
  }
  return routes;
};
