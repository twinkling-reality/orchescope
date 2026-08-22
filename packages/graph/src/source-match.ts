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
  | { readonly kind: 'matched'; readonly component: Component }
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
      if (git?.repositoryUrl !== source.repositoryUrl) {
        return {
          kind: 'refused',
          refusal: { attribute: 'vcs.repository.url.full', reason: 'repository_mismatch' },
        };
      }
      if (git.commit !== source.revision || git.dirty !== false) {
        return {
          kind: 'refused',
          refusal: { attribute: 'vcs.ref.head.revision', reason: 'revision_mismatch' },
        };
      }

      const graphFile = (() => {
        const prefix = git.repositoryPath;
        if (prefix === undefined) return source.file;
        return source.file.startsWith(`${prefix}/`)
          ? source.file.slice(prefix.length + 1)
          : undefined;
      })();
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

      const matching =
        source.line === undefined
          ? candidates
          : candidates.filter((component) =>
              component.sourceLocations.some(
                (location) =>
                  location.file === graphFile &&
                  (source.line as number) >= location.startLine &&
                  (source.line as number) <= (location.endLine ?? location.startLine),
              ),
            );
      if (matching.length === 1) {
        const component = matching[0];
        if (component !== undefined) return { kind: 'matched', component };
      }
      if (matching.length > 1) {
        return {
          kind: 'ambiguous',
          candidates: matching.map((component) => component.id),
          refusal: { attribute: 'code.file.path', reason: 'ambiguous_source_mapping' },
        };
      }
      return {
        kind: 'refused',
        refusal: { attribute: 'code.line.number', reason: 'line_outside_declaration' },
      };
    },
  };
};
