import {
  buildIdentity,
  CONFIDENCE_BANDS,
  configEntryEvidence,
  MANIFEST_NAMESPACE,
} from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type {
  ComponentDetails,
  ComponentIdentity,
  ComponentKind,
  Manifest,
  ManifestV1 as ManifestV1Document,
  ManifestV2 as ManifestV2Document,
} from '@orchescope/schema';
import {
  formatIssues,
  Manifest as ManifestSchema,
  ManifestV1,
  ManifestV2,
  MIN_READABLE_VERSIONS,
  SCHEMA_VERSIONS,
  validateDocument,
} from '@orchescope/schema';
import type { CitationRefusal } from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { jsonPointer } from '../config-files.ts';
import { createDrafts } from '../drafts.ts';

/**
 * The extension mechanism for systems no bundled adapter understands.
 *
 * A project declares components and relations in `.orchescope/manifest.yaml`. Declared facts are labelled
 * `discovered` with the manifest as their evidence, never `observed`, and they are merged with automatic
 * discovery rather than replacing it. An invalid manifest is reported as an adapter problem together with
 * the validation issues, because silently ignoring a file the user wrote on purpose is worse than failing.
 *
 * A manifest is the only input to this build that nothing checks against the repository it describes, and
 * that is what `refutations` below is for. Passing the schema says the document is well formed. It says
 * nothing about whether `definedIn` names a file that is there, whether a line that far into it exists,
 * whether an edge names anything, whether a `runtimeName` is a name a run could report, or whether details
 * describe the component kind beside them. Every one of those is answerable deterministically, and this
 * repository's own reference manifest failed three of them until it was corrected.
 */

const ADAPTER_ID = 'adapter:manifest';
const drafts = createDrafts(ADAPTER_ID);
const MANIFEST_PATHS = ['.orchescope/manifest.yaml', '.orchescope/manifest.yml'];

const validateManifest = (data: unknown) => {
  const version =
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as { readonly schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version === 1) {
    return validateDocument(
      ManifestV1,
      SCHEMA_VERSIONS.manifest,
      MIN_READABLE_VERSIONS.manifest,
      data,
    );
  }
  if (version === 2) {
    return validateDocument(
      ManifestV2,
      SCHEMA_VERSIONS.manifest,
      MIN_READABLE_VERSIONS.manifest,
      data,
    );
  }
  return validateDocument(
    ManifestSchema,
    SCHEMA_VERSIONS.manifest,
    MIN_READABLE_VERSIONS.manifest,
    data,
  );
};

type ReadableManifest = ManifestV1Document | ManifestV2Document | Manifest;
type ReadableManifestComponent = ReadableManifest['components'][number];

const detailsOf = (component: ReadableManifestComponent): ComponentDetails | undefined =>
  'details' in component ? component.details : undefined;

const manifestIdentity = (kind: ComponentKind, name: string): ComponentIdentity =>
  buildIdentity(kind, MANIFEST_NAMESPACE, name);

/**
 * What a citation claims, and what the scan can say back about it.
 *
 * Version 1 and version 2 retain the repository checks they shipped with: the traversal answers whether a
 * path exists and a byte count can refute an impossible line. Version 3 carries a write-time digest and
 * receives bounded citation snapshots from discovery. The adapter still opens nothing. It compares the
 * scanned digest and the requested line fact, then records a source location only when both claims hold.
 *
 * A `runtimeName` is the fourth, and it is the same rule the CrewAI reader applies to an interpolated role.
 * A name with a placeholder in it is a name no run will ever report, and putting one in the reconciler's
 * strongest lookup after a code location does not merely fail to match: it waits to match something else.
 */
type ManifestRefutations = {
  readonly problems: readonly string[];
  readonly verifiedLocations: ReadonlySet<number>;
};

type CitationCheck = { readonly problem?: string; readonly verified: boolean };

const citationRefusal = (component: string, path: string, refusal: CitationRefusal): string => {
  switch (refusal) {
    case 'not_walked':
      return `${component} is defined in ${path}, which this scan did not find`;
    case 'outside_root':
      return `${component} is defined in ${path}, whose resolved target is outside the repository root`;
    case 'not_regular':
      return `${component} is defined in ${path}, which is not a regular file`;
    case 'too_large':
      return `${component} is defined in ${path}, which exceeds the scan's file byte ceiling`;
    case 'binary':
      return `${component} is defined in ${path}, which contains binary data rather than deterministic source lines`;
    case 'invalid_utf8':
      return `${component} is defined in ${path}, which is not valid UTF-8 and has no deterministic line text`;
    case 'changed_during_scan':
      return `${component} is defined in ${path}, which changed while this scan was reading it`;
    case 'unreadable':
      return `${component} is defined in ${path}, which this scan could not read`;
  }
};

const version3Citation = (
  declared: ReadableManifestComponent,
  context: DiscoveryContext,
): CitationCheck => {
  if (declared.definedIn === undefined || declared.definedAtLine === undefined) {
    return { verified: false };
  }
  const declaredFileHash = 'definedFileHash' in declared ? declared.definedFileHash : undefined;
  const snapshot = context.citations.find((entry) => entry.path === declared.definedIn);
  if (snapshot === undefined) {
    return {
      verified: false,
      problem: `${declared.name} is defined in ${declared.definedIn}, which has no citation snapshot from this scan`,
    };
  }
  if (snapshot.refusal !== undefined) {
    return {
      verified: false,
      problem: citationRefusal(declared.name, declared.definedIn, snapshot.refusal),
    };
  }
  if (snapshot.contentHash !== declaredFileHash) {
    return {
      verified: false,
      problem: `${declared.name} has a stale citation for ${declared.definedIn}: the manifest records ${declaredFileHash ?? 'no digest'}, but this scan read ${snapshot.contentHash ?? 'no digest'}`,
    };
  }
  const line = snapshot.lines.find((entry) => entry.line === declared.definedAtLine);
  if (line === undefined) {
    return {
      verified: false,
      problem: `${declared.name} is defined at line ${declared.definedAtLine} of ${declared.definedIn}, which has ${snapshot.lineCount ?? 0} line(s)`,
    };
  }
  const acceptedNames = [declared.name, declared.runtimeName].filter(
    (name): name is string => name !== undefined,
  );
  return acceptedNames.some((name) => line.text.includes(name))
    ? { verified: true }
    : {
        verified: false,
        problem: `${declared.name} cites line ${declared.definedAtLine} of ${declared.definedIn}, which contains neither its component name nor its runtime name`,
      };
};

const legacyCitationProblem = (
  declared: ReadableManifestComponent,
  walked: ReadonlyMap<string, number | undefined>,
): string | undefined => {
  if (declared.definedIn === undefined) return undefined;
  const byteLength = walked.get(declared.definedIn);
  if (!walked.has(declared.definedIn)) {
    return `${declared.name} is defined in ${declared.definedIn}, which this scan did not find`;
  }
  if (declared.definedAtLine === undefined) {
    return `${declared.name} is defined in ${declared.definedIn} at no stated line, so there is no location to record`;
  }
  return byteLength !== undefined && declared.definedAtLine > byteLength
    ? `${declared.name} is defined at line ${declared.definedAtLine} of ${declared.definedIn}, which is ${byteLength} bytes long`
    : undefined;
};

const refutations = (
  manifest: ReadableManifest,
  context: DiscoveryContext,
  configFile: string,
): ManifestRefutations => {
  const walked = new Map(context.files.map((file) => [file.path, file.byteLength]));
  const found: string[] = [];
  const verifiedLocations = new Set<number>();

  for (const [index, declared] of manifest.components.entries()) {
    const details = detailsOf(declared);
    if (details !== undefined && details.for !== declared.kind) {
      found.push(`${declared.name} has kind ${declared.kind} but details for ${details.for}`);
    }
    if (manifest.schemaVersion === 3) {
      const citation = version3Citation(declared, context);
      if (citation.problem !== undefined) found.push(citation.problem);
      if (citation.verified) verifiedLocations.add(index);
    } else {
      const problem = legacyCitationProblem(declared, walked);
      if (problem !== undefined) {
        found.push(problem);
      } else if (declared.definedIn !== undefined) {
        verifiedLocations.add(index);
      }
    }
    if (declared.runtimeName?.includes('{') === true) {
      found.push(
        `${declared.name} declares the runtime name ${declared.runtimeName}, which carries a placeholder and is a name no run reports`,
      );
    }
  }

  for (const declared of manifest.edges) {
    for (const endpoint of [declared.from, declared.to]) {
      if (resolveEndpoint(manifest, context, configFile, endpoint) !== undefined) continue;
      found.push(
        `the ${declared.kind} relation names ${endpoint}, which this manifest does not declare and nothing else discovered`,
      );
    }
  }

  return { problems: found, verifiedLocations };
};

/**
 * Resolves a manifest edge endpoint. A name declared in the manifest wins, and otherwise the name is
 * looked up against components discovered by other adapters so a manifest can annotate real code.
 */
const resolveEndpoint = (
  manifest: ReadableManifest,
  context: DiscoveryContext,
  configPath: string,
  name: string,
): ComponentIdentity | undefined => {
  const declared = manifest.components.find((component) => component.name === name);
  if (declared !== undefined) return manifestIdentity(declared.kind, name);
  return context.bindings.lookup(configPath, name);
};

const addDeclaredComponent = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  configFile: string,
  declared: ReadableManifestComponent,
  index: number,
  includeSourceLocation: boolean,
): void => {
  const details = detailsOf(declared);
  const sourceLocation =
    includeSourceLocation &&
    declared.definedIn !== undefined &&
    declared.definedAtLine !== undefined
      ? { file: declared.definedIn, startLine: declared.definedAtLine }
      : undefined;
  const identity = manifestIdentity(declared.kind, declared.name);
  const pointer = jsonPointer(['components', index]);
  builder.addComponent({
    identity,
    kind: declared.kind,
    displayName: declared.displayName ?? declared.name,
    ...(declared.description === undefined ? {} : { description: declared.description }),
    basis: 'discovered',
    confidence: CONFIDENCE_BANDS.strongStructural,
    discoveredBy: ADAPTER_ID,
    presence: { static: true, runtime: false, manifest: true },
    ...(sourceLocation === undefined ? {} : { sourceLocations: [sourceLocation] }),
    configLocations: [{ file: configFile, pointer }],
    evidence: [
      configEntryEvidence({
        producer: ADAPTER_ID,
        location: { file: configFile, pointer },
        value: `${declared.kind} ${declared.name}`,
      }),
    ],
    ...(declared.sideEffect === undefined ? {} : { sideEffect: declared.sideEffect }),
    ...(declared.permissions === undefined ? {} : { permissions: declared.permissions }),
    ...(details === undefined || details.for !== declared.kind ? {} : { details }),
    tags: [...(declared.tags ?? []), 'manifest'],
    metadata: {
      ...(declared.metadata ?? {}),
      declaredInManifest: true,
      ...(declared.runtimeName === undefined ? {} : { runtimeName: declared.runtimeName }),
    },
  });
  context.bindings.register(configFile, declared.name, identity);
};

/** An edge whose endpoints cannot both be resolved is skipped: a relation to nothing is not a relation. */
const addDeclaredEdges = (
  manifest: ReadableManifest,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  configFile: string,
): number => {
  let edges = 0;
  for (const [index, declared] of manifest.edges.entries()) {
    const from = resolveEndpoint(manifest, context, configFile, declared.from);
    const to = resolveEndpoint(manifest, context, configFile, declared.to);
    if (from === undefined || to === undefined) continue;
    builder.addEdge(
      drafts.edge({
        kind: declared.kind,
        from,
        to,
        configFile,
        pointer: jsonPointer(['edges', index]),
        ...(declared.policy === undefined ? {} : { policy: declared.policy }),
        confidence: CONFIDENCE_BANDS.strongStructural,
      }),
    );
    edges += 1;
  }
  return edges;
};

export const manifestAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  // The manifest is a file this repository writes, not a package it depends on.
  packages: [],
  appliesTo: (context) =>
    context.configs.some((document) => MANIFEST_PATHS.includes(document.path)),
  discover: (context, builder): AdapterFindings => {
    const document = context.configs.find((candidate) => MANIFEST_PATHS.includes(candidate.path));
    if (document === undefined) {
      return { componentsFound: 0, edgesFound: 0, filesInspected: [] };
    }
    const validated = validateManifest(document.data);
    if (!validated.ok) {
      return {
        componentsFound: 0,
        edgesFound: 0,
        filesInspected: [document.path],
        problem: `${document.path} is not a valid manifest: ${formatIssues(validated.issues)}`,
      };
    }
    const manifest = validated.value as ReadableManifest;
    const refuted = refutations(manifest, context, document.path);
    for (const [index, declared] of manifest.components.entries()) {
      addDeclaredComponent(
        context,
        builder,
        document.path,
        declared,
        index,
        manifest.schemaVersion !== 3 || refuted.verifiedLocations.has(index),
      );
    }
    const edgesFound = addDeclaredEdges(manifest, context, builder, document.path);
    /*
     * What was read stays read: a manifest with one citation the scan refutes still declares seventeen the
     * scan does not, and dropping those would trade a wrong answer for a missing one. Version 3 leaves a
     * refuted source location out, so the remaining declaration never presents stale source as current.
     */
    return {
      componentsFound: manifest.components.length,
      edgesFound,
      filesInspected: [document.path],
      ...(refuted.problems.length === 0
        ? {}
        : {
            problem: `${document.path} makes ${refuted.problems.length} claim(s) this scan refutes: ${refuted.problems.join('; ')}`,
          }),
    };
  },
};
