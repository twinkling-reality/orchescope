import { normalizeLocalName } from '@orchescope/domain';
import type {
  Component,
  ComponentId,
  ObservedContentLocation,
  ObservedSource,
  SystemGraph,
} from '@orchescope/schema';

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

/**
 * The one reason only a content proof can give: the file on disk is not the file the run read.
 *
 * Kept out of the pinned vocabulary because a pinned match can never produce it, and a federated join
 * reads pinned proofs only. A reason nothing can emit into a surface is a reason that surface should not
 * declare.
 */
export type ContentMatchRefusal =
  | SourceMatchRefusal
  | { readonly attribute: string; readonly reason: 'digest_mismatch' };

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

export type ContentMatchResult =
  | SourceMatchResult
  | { readonly kind: 'refused'; readonly refusal: ContentMatchRefusal };

export type ObservedSourceEndpoint = {
  readonly observedKind: string;
  readonly observedName: string;
  readonly observedSource: ObservedSource;
};

export type ObservedContentEndpoint = {
  readonly observedKind: string;
  readonly observedName: string;
  readonly observedContent: ObservedContentLocation;
};

export type SourceMatcher = {
  readonly graph: SystemGraph;
  /** The pinned proof: a repository, a revision and a path both sides agree on. */
  readonly match: (endpoint: ObservedSourceEndpoint) => SourceMatchResult;
  /** The content proof: a path inside the scanned root and the digest of the file. */
  readonly matchContent: (endpoint: ObservedContentEndpoint) => ContentMatchResult;
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

const notDeclared: SourceMatchRefusal = {
  attribute: 'code.file.path',
  reason: 'source_not_declared',
};

/**
 * Whether the run and the scan are talking about the same code, which is asked before anything is matched.
 *
 * A different remote or a different revision means the location describes source this graph was not read
 * from, and a dirty tree means the scan cannot say what the revision contained. Nothing weaker is
 * accepted, because this is the gate federation depends on.
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
 * Builds the strict source index shared by single-repository reconciliation and federation.
 *
 * No name-only lookup exists here. A source-bearing endpoint either resolves inside the exact clean
 * repository coordinate or returns the reason it was refused.
 */
type DeclarationIndex = ReadonlyMap<string, Component[]>;

/** The last path segment of a name, which is how a qualified runtime name meets a bare declaration. */
const bareName = (name: string): string => {
  const slash = name.lastIndexOf('/');
  return slash < 0 ? name : name.slice(slash + 1);
};

/**
 * Declarations in one file that answer to one observed kind and name.
 *
 * The qualified form is tried first and the bare one second, which is the ladder the name rules already
 * climb: a model declared as `demo-small` is reported at runtime as `unspecified/demo-small`, because the
 * provider is part of what a run saw and not part of what a repository wrote down. A location that
 * refused over that difference would be refusing over a spelling, in a file both sides agree on.
 */
const declarationsAt = (
  index: DeclarationIndex,
  graphFile: string,
  observedKind: string,
  observedName: string,
): readonly Component[] => {
  const normalized = normalizeLocalName(observedName);
  const at = (name: string): readonly Component[] => [
    ...new Map(
      (index.get(`${graphFile}|${observedKind}|${name}`) ?? []).map((component) => [
        component.id,
        component,
      ]),
    ).values(),
  ];
  const exact = at(normalized);
  if (exact.length > 0) return exact;
  const bare = bareName(normalized);
  return bare === normalized ? exact : at(bare);
};

/**
 * The line narrows a choice; it does not veto the only candidate.
 *
 * A line is a discriminator among declarations that share a file, a kind and a name, which is what this
 * index is built on. Where it eliminates every candidate it has discriminated nothing, so it stops being
 * a filter and the file, the kind and the name decide as they would have if no line had been reported.
 * That matters because a line can come from either end of the thing it describes: an instrumentor
 * wrapping a constructor reports the declaration, and a shim on the transport reports the call, which is
 * by construction somewhere else in the file. Vetoing on the second would refuse a join that the same
 * span carrying no line at all would have made.
 *
 * The part that did not corroborate travels with the match rather than being dropped, so coverage still
 * records that a line was read and did not agree.
 */
const selectOn = (
  candidates: readonly Component[],
  graphFile: string,
  line: number | undefined,
): SourceMatchResult => {
  const withinRange = (component: Component): boolean =>
    component.sourceLocations.some(
      (location) =>
        location.file === graphFile &&
        (line as number) >= location.startLine &&
        (line as number) <= (location.endLine ?? location.startLine),
    );
  const onTheLine = line === undefined ? candidates : candidates.filter(withinRange);
  const lineDecided = onTheLine.length > 0;
  const matching = lineDecided ? onTheLine : candidates;
  const caveat: SourceMatchRefusal | undefined = lineDecided
    ? undefined
    : { attribute: 'code.line.number', reason: 'line_outside_declaration' };

  if (matching.length === 1) {
    const component = matching[0];
    if (component !== undefined) {
      return { kind: 'matched', component, ...(caveat === undefined ? {} : { refusal: caveat }) };
    }
  }
  return {
    kind: 'ambiguous',
    candidates: matching.map((component) => component.id),
    refusal: caveat ?? { attribute: 'code.file.path', reason: 'ambiguous_source_mapping' },
  };
};

export const createSourceMatcher = (graph: SystemGraph): SourceMatcher => {
  const byFileKindAndName = new Map<string, Component[]>();
  for (const component of graph.components) {
    for (const location of component.sourceLocations) {
      for (const name of componentNames(component)) {
        push(byFileKindAndName, `${location.file}|${component.kind}|${name}`, component);
        const bare = bareName(name);
        if (bare !== name)
          push(byFileKindAndName, `${location.file}|${component.kind}|${bare}`, component);
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
      if (graphFile === undefined) return { kind: 'refused', refusal: notDeclared };
      const candidates = declarationsAt(
        byFileKindAndName,
        graphFile,
        endpoint.observedKind,
        endpoint.observedName,
      );
      if (candidates.length === 0) return { kind: 'refused', refusal: notDeclared };
      return selectOn(candidates, graphFile, source.line);
    },

    matchContent: (endpoint) => {
      const content = endpoint.observedContent;
      const candidates = declarationsAt(
        byFileKindAndName,
        content.file,
        endpoint.observedKind,
        endpoint.observedName,
      );
      if (candidates.length === 0) return { kind: 'refused', refusal: notDeclared };

      /*
       * Checked per declaration, because a digest is a statement about one file and a declaration is what
       * names the file it was read from. A declaration recorded without a digest cannot corroborate and
       * is not treated as though it had: the scan records one for every file it opened, so its absence
       * means the location names something the scan never read.
       */
      const sameFile = candidates.filter((component) =>
        component.sourceLocations.some(
          (location) => location.file === content.file && location.fileHash === content.digest,
        ),
      );
      if (sameFile.length === 0) {
        return {
          kind: 'refused',
          refusal: { attribute: 'orchescope.code.file.digest', reason: 'digest_mismatch' },
        };
      }
      return selectOn(sameFile, content.file, content.line);
    },
  };
};
