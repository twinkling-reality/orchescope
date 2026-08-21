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
 *
 * A manifest is the only input to this build that nothing checks against the repository it describes, and
 * that is what `refutations` below is for. Passing the schema says the document is well formed. It says
 * nothing about whether `definedIn` names a file that is there, whether a line that far into it exists,
 * whether an edge names anything, or whether a `runtimeName` is a name a run could report. Every one of
 * those is answerable deterministically from what the scan already walked, and this repository's own
 * reference manifest failed three of them until it was corrected.
 */

const ADAPTER_ID = 'adapter:manifest';
const drafts = createDrafts(ADAPTER_ID);
const MANIFEST_PATHS = ['.orchescope/manifest.yaml', '.orchescope/manifest.yml'];

const manifestIdentity = (kind: ComponentKind, name: string): ComponentIdentity =>
  buildIdentity(kind, MANIFEST_NAMESPACE, name);

/**
 * What a citation claims, and what the scan can say back about it.
 *
 * The engine accepted `definedIn: src/does-not-exist.rb, definedAtLine: 4242` and reported the component as
 * a real one with a location a reader could click. Two of these are exact: a path either is a file the
 * traversal walked or it is not, and an edge endpoint either names something or it does not. The line check
 * is a refutation rather than a confirmation, because confirming it would mean opening the file and an
 * adapter never does: a file of two hundred bytes cannot have a line four thousand deep, and that is as far
 * as the byte count reaches.
 *
 * A `runtimeName` is the fourth, and it is the same rule the CrewAI reader applies to an interpolated role.
 * A name with a placeholder in it is a name no run will ever report, and putting one in the reconciler's
 * strongest lookup after a code location does not merely fail to match: it waits to match something else.
 */
const refutations = (
  manifest: Manifest,
  context: DiscoveryContext,
  configFile: string,
): readonly string[] => {
  const walked = new Map(context.files.map((file) => [file.path, file.byteLength]));
  const found: string[] = [];

  for (const declared of manifest.components) {
    if (declared.definedIn !== undefined) {
      const byteLength = walked.get(declared.definedIn);
      if (!walked.has(declared.definedIn)) {
        found.push(
          `${declared.name} is defined in ${declared.definedIn}, which this scan did not find`,
        );
      } else if (declared.definedAtLine === undefined) {
        /*
         * A file with no line is a citation this build cannot record without inventing one, because a
         * source location has a line and there is no way to write "somewhere in here". It used to record
         * line 1, which is a claim the manifest never made and a link a reader follows to the imports.
         */
        found.push(
          `${declared.name} is defined in ${declared.definedIn} at no stated line, so there is no location to record`,
        );
      } else if (byteLength !== undefined && declared.definedAtLine > byteLength) {
        found.push(
          `${declared.name} is defined at line ${declared.definedAtLine} of ${declared.definedIn}, which is ${byteLength} bytes long`,
        );
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

  return found;
};

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
    ...(declared.definedIn === undefined || declared.definedAtLine === undefined
      ? {}
      : {
          sourceLocations: [{ file: declared.definedIn, startLine: declared.definedAtLine }],
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
  // The manifest is a file this repository writes, not a package it depends on.
  packages: [],
  appliesTo: (context) =>
    context.configs.some((document) => MANIFEST_PATHS.includes(document.path)),
  discover: (context, builder): AdapterFindings => {
    const document = context.configs.find((candidate) => MANIFEST_PATHS.includes(candidate.path));
    if (document === undefined) {
      return { componentsFound: 0, edgesFound: 0, filesInspected: [] };
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
        filesInspected: [document.path],
        problem: `${document.path} is not a valid manifest: ${formatIssues(validated.issues)}`,
      };
    }
    const manifest = validated.value as Manifest;
    for (const [index, declared] of manifest.components.entries()) {
      addDeclaredComponent(context, builder, document.path, declared, index);
    }
    const edgesFound = addDeclaredEdges(manifest, context, builder, document.path);
    /*
     * Refuted after the components are added, because an edge endpoint is answered against what every
     * adapter found and a manifest that annotates real code names components it does not declare. What was
     * read stays read: a manifest with one citation the scan refutes still declares seventeen the scan does
     * not, and dropping those would trade a wrong answer for a missing one.
     */
    const refuted = refutations(manifest, context, document.path);
    return {
      componentsFound: manifest.components.length,
      edgesFound,
      filesInspected: [document.path],
      ...(refuted.length === 0
        ? {}
        : {
            problem: `${document.path} makes ${refuted.length} claim(s) this scan refutes: ${refuted.join('; ')}`,
          }),
    };
  },
};
