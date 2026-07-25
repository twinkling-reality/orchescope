import {
  buildIdentity,
  CONFIDENCE_BANDS,
  configEntryEvidence,
  MANIFEST_NAMESPACE,
} from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, ComponentKind, Manifest } from '@orchescope/schema';
import {
  formatIssues,
  Manifest as ManifestSchema,
  MIN_READABLE_VERSIONS,
  SCHEMA_VERSIONS,
  validateDocument,
} from '@orchescope/schema';
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
 */

const ADAPTER_ID = 'adapter:manifest';
const drafts = createDrafts(ADAPTER_ID);
const MANIFEST_PATHS = ['.orchescope/manifest.yaml', '.orchescope/manifest.yml'];

const manifestIdentity = (kind: ComponentKind, name: string): ComponentIdentity =>
  buildIdentity(kind, MANIFEST_NAMESPACE, name);

/**
 * Resolves a manifest edge endpoint. A name declared in the manifest wins, and otherwise the name is
 * looked up against components discovered by other adapters so a manifest can annotate real code.
 */
const resolveEndpoint = (
  manifest: Manifest,
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
  declared: Manifest['components'][number],
  index: number,
): void => {
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
    ...(declared.definedIn === undefined
      ? {}
      : {
          sourceLocations: [{ file: declared.definedIn, startLine: declared.definedAtLine ?? 1 }],
        }),
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
  manifest: Manifest,
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
  version: '1',
  ecosystem: 'manifest',
  // The manifest is a file this repository writes, not a package it depends on.
  packages: [],
  appliesTo: (context) =>
    context.configs.some((document) => MANIFEST_PATHS.includes(document.path)),
  discover: (context, builder): AdapterFindings => {
    const document = context.configs.find((candidate) => MANIFEST_PATHS.includes(candidate.path));
    if (document === undefined) {
      return { componentsFound: 0, edgesFound: 0, filesInspected: 0 };
    }
    const validated = validateDocument(
      ManifestSchema,
      SCHEMA_VERSIONS.manifest,
      MIN_READABLE_VERSIONS.manifest,
      document.data,
    );
    if (!validated.ok) {
      return {
        componentsFound: 0,
        edgesFound: 0,
        filesInspected: 1,
        problem: `${document.path} is not a valid manifest: ${formatIssues(validated.issues)}`,
      };
    }
    const manifest = validated.value as Manifest;
    for (const [index, declared] of manifest.components.entries()) {
      addDeclaredComponent(context, builder, document.path, declared, index);
    }
    return {
      componentsFound: manifest.components.length,
      edgesFound: addDeclaredEdges(manifest, context, builder, document.path),
      filesInspected: 1,
    };
  },
};
