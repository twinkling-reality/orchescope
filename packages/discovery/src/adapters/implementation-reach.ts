import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type { CallFact, ModuleFacts } from '@orchescope/source-analysis';
import { calleeName, dotted } from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { callRelationKind } from '../call-relation.ts';
import { createDrafts } from '../drafts.ts';
import type { ImplementationSpan } from '../implementation-span.ts';

/**
 * What the body of a declared component reaches.
 *
 * Every other adapter reads a declaration and stops at its edge: this one reads what the declaration
 * runs. A tool declared by `registerTool` and implemented by a handler that calls a function performing
 * a `DELETE` was three components with no path between them, so the write was present, correctly
 * classified as destructive, and reachable from nothing. Three rules were wrong at once because of it,
 * and only one of the three could have been fixed inside the rule.
 *
 * The join is by line containment rather than by enclosing scope. An inline handler is anonymous, so
 * the nearest named scope of a call inside it is whatever encloses the registration, which at module
 * scope is nothing at all. Containment is the only fact in the model that says the call belongs to the
 * body, and it is the fact the registration call already carries.
 *
 * What a contained call reaches is answered by its name where it has one and by its call site where it
 * does not, which is the difference between a handler delegating to a declared function and a handler
 * making the request itself.
 *
 * This runs last, because it draws relations between components other adapters declare and cannot draw
 * one to a component that does not exist yet. It declares nothing of its own.
 */

const ADAPTER_ID = 'adapter:implementation-reach';
const drafts = createDrafts(ADAPTER_ID);

const endLineOf = (location: SourceLocation): number => location.endLine ?? location.startLine;

/**
 * Whether a call sits inside a body, by line.
 *
 * The declaring call is excluded by its own start line: a registration call opens the span it defines,
 * and reading it as a call the body makes would draw every tool a relation to itself.
 */
const insideBody = (body: SourceLocation, call: CallFact): boolean =>
  call.location.startLine > body.startLine && endLineOf(call.location) <= endLineOf(body);

const callsInside = (module: ModuleFacts, span: ImplementationSpan): readonly CallFact[] =>
  module.calls.filter((call) => insideBody(span.body, call));

/**
 * The component a call inside a body reaches.
 *
 * A name first, because a name is the stronger fact: it resolves across modules and it survives two
 * functions in one file requesting different hosts. The call site answers where no name does, which is
 * a handler that makes the request itself rather than delegating to something someone declared.
 *
 * That second half is the whole of a defect this join shipped with. The delegating spelling reached the
 * write, was classified, and fired the rule; the inline spelling reached nothing and the rule reported
 * that no consequential operation had been discovered, four lines from a POST. Which of the two an
 * author had written decided whether a security rule could fire, and the inline one is what the
 * frameworks document.
 */
const reachedBy = (
  context: DiscoveryContext,
  file: string,
  call: CallFact,
): ComponentIdentity | undefined => {
  const name = calleeName(call);
  const declared = name === '' ? undefined : context.bindings.lookup(file, name);
  return declared ?? context.callSiteEffects.at(file, call)?.identity;
};

export const implementationReachAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
  // A body is a convention of the language, not a package.
  packages: [],
  appliesTo: (context) => context.implementations.all().length > 0,
  discover: (context, builder): AdapterFindings => {
    let edges = 0;
    const files = new Set<string>();
    for (const span of context.implementations.all()) {
      const module = context.symbols.moduleOf(span.file);
      if (module === undefined) continue;
      /*
       * One relation per pair. A handler that calls the same operation in two branches calls it once as
       * far as the graph is concerned, and reporting it twice would weight the relation by how the body
       * happens to be written.
       */
      const drawn = new Set<string>();
      for (const call of callsInside(module, span)) {
        const target = reachedBy(context, span.file, call);
        if (target === undefined) continue;
        const key = `${target.kind}:${target.namespace}:${target.localName}`;
        /*
         * A tool that calls itself is recursion, and a relation from a component to itself says nothing
         * the graph can be asked about, which is why the domain refuses to build one. Three of them in
         * `pydantic-ai` ended the whole scan with an invariant violation rather than a finding.
         *
         * The declaring call is already excluded by line, so this is the case where a decorated tool's
         * body reaches the name the decorator registered: the definition is the span and the call is
         * inside it.
         */
        if (key === `${span.identity.kind}:${span.identity.namespace}:${span.identity.localName}`) {
          continue;
        }
        if (drawn.has(key)) continue;
        drawn.add(key);
        builder.addEdge(
          drafts.edge({
            kind: callRelationKind(target.kind),
            from: span.identity,
            to: target,
            location: call.location,
            symbol: `${span.symbol} calls ${dotted(call.calleePath)}`,
            /*
             * Structural rather than strong: the name resolved to a definition this scan read, and
             * whether that definition is what runs depends on bindings a parser cannot follow.
             */
            confidence: CONFIDENCE_BANDS.structural,
            metadata: { reachedThrough: 'implementation body' },
          }),
        );
        edges += 1;
        files.add(span.file);
      }
    }
    return { componentsFound: 0, edgesFound: edges, filesInspected: files.size };
  },
};
