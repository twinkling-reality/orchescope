import { normalizeLocalName } from '@orchescope/domain';
import type { Component, ComponentId, ObservedSource, SystemGraph } from '@orchescope/schema';

/** Why a complete observed source identity could not select one declaration. */
export type SourceMatchRefusal = {
  readonly attribute: string;
  readonly reason:
    | 'repository_mismatch'
    | 'revision_mismatch'
    | 'source_not_declared'
    | 'line_outside_declaration'
    | 'ambiguous_source_mapping';
};

export type SourceMatchResult =
  | {
      readonly kind: 'matched';
      readonly component: Component;
      /** Present when the location selected the declaration but one part of it did not corroborate. */
      readonly refusal?: SourceMatchRefusal;
    }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly ComponentId[];
      readonly refusal: SourceMatchRefusal;
    }
  | { readonly kind: 'refused'; readonly refusal: SourceMatchRefusal };

export type ObservedSourceEndpoint = {
  readonly observedKind: string;
  readonly observedName: string;
  readonly observedSource: ObservedSource;
};

export type SourceMatcher = {
  readonly graph: SystemGraph;
  readonly match: (endpoint: ObservedSourceEndpoint) => SourceMatchResult;
};

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
};

const componentNames = (component: Component): readonly string[] => {
  const names = [normalizeLocalName(component.identity.localName)];
  const runtimeName = component.metadata['runtimeName'];
  if (typeof runtimeName === 'string' && runtimeName.length > 0) {
    names.push(normalizeLocalName(runtimeName));
  }
  return [...new Set(names)];
};

/**
 * Whether the run and the scan are talking about the same code, which is asked before anything is matched.
 *
 * A different remote or a different revision means the location describes source this graph was not read
 * from, and a dirty tree means the scan cannot say what the revision contained. Nothing weaker than
 * agreement is accepted here, because this is the gate federation depends on.
 */
const coordinateRefusal = (
  git: SystemGraph['provenance']['git'],
  source: ObservedSource['identity'],
): SourceMatchRefusal | undefined => {
  if (git?.repositoryUrl !== source.repositoryUrl) {
    return { attribute: 'vcs.repository.url.full', reason: 'repository_mismatch' };
  }
  if (git.commit !== source.revision || git.dirty !== false) {
    return { attribute: 'vcs.ref.head.revision', reason: 'revision_mismatch' };
  }
  return undefined;
};

/**
 * The observed path, rebased onto the root the graph was scanned from.
 *
 * A runtime coordinate is relative to the repository root and a declaration is relative to the scan
 * root, and the two differ whenever the audit target is a directory inside a larger checkout. The prefix
 * the scan recorded is what closes that gap; a path that does not carry it names a file outside the
 * scanned tree.
 */
const rebasedOnScanRoot = (prefix: string | undefined, file: string): string | undefined => {
  if (prefix === undefined) return file;
  return file.startsWith(`${prefix}/`) ? file.slice(prefix.length + 1) : undefined;
};

/**
 * Builds the strict source index shared by single-repository reconciliation and federation.
 *
 * No name-only lookup exists here. A source-bearing endpoint either resolves inside the exact clean
 * repository coordinate or returns the reason it was refused.
 */
export const createSourceMatcher = (graph: SystemGraph): SourceMatcher => {
  const byFileKindAndName = new Map<string, Component[]>();
  for (const component of graph.components) {
    for (const location of component.sourceLocations) {
      for (const name of componentNames(component)) {
        push(byFileKindAndName, `${location.file}|${component.kind}|${name}`, component);
      }
    }
  }

  return {
    graph,
    match: (endpoint) => {
      const source = endpoint.observedSource.identity;
      const git = graph.provenance.git;
      const mismatch = coordinateRefusal(git, source);
      if (mismatch !== undefined) return { kind: 'refused', refusal: mismatch };

      const graphFile = rebasedOnScanRoot(git?.repositoryPath, source.file);
      if (graphFile === undefined) {
        return {
          kind: 'refused',
          refusal: { attribute: 'code.file.path', reason: 'source_not_declared' },
        };
      }
      const key = `${graphFile}|${endpoint.observedKind}|${normalizeLocalName(endpoint.observedName)}`;
      const candidates = [
        ...new Map(
          (byFileKindAndName.get(key) ?? []).map((component) => [component.id, component]),
        ).values(),
      ];
      if (candidates.length === 0) {
        return {
          kind: 'refused',
          refusal: { attribute: 'code.file.path', reason: 'source_not_declared' },
        };
      }

      /*
       * The line narrows a choice; it does not veto the only candidate.
       *
       * A line is a discriminator among declarations that share a file, a kind and a name, which is what
       * this index is built on. Where it eliminates every candidate it has discriminated nothing, so it
       * stops being a filter and the file, the kind and the name decide as they would have if no line
       * had been reported. That matters because a line can come from either end of the thing it
       * describes: an instrumentor wrapping a constructor reports the declaration, and a shim on the
       * transport reports the call, which is by construction somewhere else in the file. Vetoing on the
       * second would refuse a join that the same span carrying no line at all would have made.
       *
       * The part that did not corroborate travels with the match rather than being dropped, so coverage
       * still records that a line was read and did not agree.
       */
      const withinRange = (component: Component): boolean =>
        component.sourceLocations.some(
          (location) =>
            location.file === graphFile &&
            (source.line as number) >= location.startLine &&
            (source.line as number) <= (location.endLine ?? location.startLine),
        );
      const onTheLine = source.line === undefined ? candidates : candidates.filter(withinRange);
      const lineDecided = onTheLine.length > 0;
      const matching = lineDecided ? onTheLine : candidates;
      const caveat: SourceMatchRefusal | undefined = lineDecided
        ? undefined
        : { attribute: 'code.line.number', reason: 'line_outside_declaration' };

      if (matching.length === 1) {
        const component = matching[0];
        if (component !== undefined) {
          return {
            kind: 'matched',
            component,
            ...(caveat === undefined ? {} : { refusal: caveat }),
          };
        }
      }
      return {
        kind: 'ambiguous',
        candidates: matching.map((component) => component.id),
        refusal: caveat ?? { attribute: 'code.file.path', reason: 'ambiguous_source_mapping' },
      };
    },
  };
};
