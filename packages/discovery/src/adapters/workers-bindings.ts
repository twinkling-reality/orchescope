import { CONFIDENCE_BANDS, isTestFile } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type {
  ComponentIdentity,
  ComponentKind,
  EdgeKind,
  SourceLocation,
} from '@orchescope/schema';
import type { ArgumentFact, ModuleFacts } from '@orchescope/source-analysis';

import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { asRecord, asString, type ConfigDocument, jsonPointer } from '../config-files.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';

/**
 * Infrastructure a Cloudflare Workers manifest binds to the code that deploys with it.
 *
 * A worker reaches its database, its key value namespaces, its buckets and its queues through bindings, and a binding
 * exists only in `wrangler.toml`. Nothing in the source declares the resource: `env.EVENTS_DB` is a property access
 * whose meaning is in a file no source reader opens. A scan of one repository mapped no datastore at all while fifty
 * seven prepared statements ran against a D1 database that manifest declares, and the only `sqlite` in its graph came
 * from a `FakeD1` in a test helper. The declaration and the use are each half of the same fact.
 *
 * The binding name is the join. It is declared in the manifest and it is the name the code uses, so a module that
 * names it is a module that reaches that resource. That is a structural claim rather than a strong one: passing
 * `env.EVENTS_DB` to a function is evidence the caller reaches the database, and it is not evidence of what it does
 * there, so the relation is recorded and the operation is not guessed.
 */

const ADAPTER_ID = 'adapter:workers-bindings';
const drafts = createDrafts(ADAPTER_ID);

type BindingKind = {
  /** The manifest key holding an array of binding entries. */
  readonly key: string;
  readonly componentKind: ComponentKind;
  readonly edgeKind: EdgeKind;
  /** The entry key naming the resource itself, which outlives the name any one worker binds it to. */
  readonly resourceKey: string;
  readonly namespace: string;
  readonly service: string;
  readonly tag: string;
};

const BINDING_KINDS: readonly BindingKind[] = [
  {
    key: 'd1_databases',
    componentKind: 'database',
    edgeKind: 'queries_database',
    resourceKey: 'database_name',
    namespace: GLOBAL_NAMESPACES.datastore,
    service: 'cloudflare-d1',
    tag: 'sql',
  },
  {
    key: 'kv_namespaces',
    componentKind: 'database',
    edgeKind: 'queries_database',
    resourceKey: 'binding',
    namespace: GLOBAL_NAMESPACES.datastore,
    service: 'cloudflare-kv',
    tag: 'key-value',
  },
  {
    key: 'r2_buckets',
    componentKind: 'database',
    edgeKind: 'queries_database',
    resourceKey: 'bucket_name',
    namespace: GLOBAL_NAMESPACES.datastore,
    service: 'cloudflare-r2',
    tag: 'object-storage',
  },
  {
    key: 'queues',
    componentKind: 'queue',
    edgeKind: 'publishes_to_queue',
    resourceKey: 'queue',
    namespace: GLOBAL_NAMESPACES.queue,
    service: 'cloudflare-queues',
    tag: 'queue',
  },
];

type Binding = {
  readonly kind: BindingKind;
  readonly binding: string;
  readonly resource: string;
  readonly identity: ComponentIdentity;
  readonly configFile: string;
  readonly pointer: string;
};

/**
 * A manifest is recognised by its file name and by holding at least one key Workers defines, so that a `wrangler.toml`
 * belonging to something else is not read as one.
 */
const MANIFEST_KEYS = ['name', 'main', 'compatibility_date', 'account_id', 'workers_dev'];

const isWorkersManifest = (document: ConfigDocument): boolean => {
  const root = asRecord(document.data);
  if (root === undefined) return false;
  if (!(document.path === 'wrangler.toml' || document.path.endsWith('/wrangler.toml'))) {
    if (!/(^|\/)wrangler\.jsonc?$/.test(document.path)) return false;
  }
  return (
    MANIFEST_KEYS.some((key) => root[key] !== undefined) ||
    BINDING_KINDS.some((kind) => Array.isArray(root[kind.key]))
  );
};

/**
 * `[[queues]]` is not a list of queues. Workers nests producers and consumers under it, and only a producer names a
 * queue this worker writes to, so the two are read separately rather than as one array of entries.
 */
type BindingEntry = {
  readonly entry: Record<string, unknown>;
  readonly pointer: readonly (string | number)[];
};

const queueEntries = (root: Record<string, unknown>): readonly BindingEntry[] => {
  const queues = asRecord(root['queues']);
  if (queues === undefined) return [];
  const producers: readonly unknown[] = Array.isArray(queues['producers'])
    ? queues['producers']
    : [];
  return producers.flatMap((value, index) => {
    const entry = asRecord(value);
    return entry === undefined ? [] : [{ entry, pointer: ['queues', 'producers', index] }];
  });
};

const bindingsOf = (document: ConfigDocument): readonly Binding[] => {
  const root = asRecord(document.data);
  if (root === undefined) return [];
  const found: Binding[] = [];
  for (const kind of BINDING_KINDS) {
    const value = root[kind.key];
    const declared: readonly unknown[] = Array.isArray(value) ? value : [];
    const entries: readonly BindingEntry[] =
      kind.key === 'queues'
        ? queueEntries(root)
        : declared.flatMap((item, index) => {
            const entry = asRecord(item);
            return entry === undefined ? [] : [{ entry, pointer: [kind.key, index] }];
          });
    for (const { entry, pointer } of entries) {
      const binding = asString(entry['binding']);
      if (binding === undefined) continue;
      const resource = asString(entry[kind.resourceKey]) ?? binding;
      found.push({
        kind,
        binding,
        resource,
        identity: globalIdentity(kind.componentKind, kind.namespace, resource),
        configFile: document.path,
        pointer: jsonPointer(pointer),
      });
    }
  }
  return found;
};

/**
 * The enclosing scope, resolved through the shared binding registry so that a function which already exists because
 * it makes an HTTP call is the same component here rather than a second one with the same name.
 */
const ensureCaller = (input: {
  readonly module: ModuleFacts;
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly name: string;
  readonly location: SourceLocation;
}): { readonly identity: ComponentIdentity; readonly added: boolean } => {
  const existing = input.context.bindings.lookup(input.module.file, input.name);
  if (existing !== undefined) return { identity: existing, added: false };
  const identity = sourceIdentity('entrypoint', input.module.file, input.name);
  input.builder.addComponent(
    drafts.sourceComponent({
      kind: 'entrypoint',
      file: input.module.file,
      name: input.name,
      location: input.location,
      symbol: input.name,
      confidence: CONFIDENCE_BANDS.structural,
      metadata: { inferredFrom: 'enclosing scope of a platform binding' },
      tags: ['entrypoint'],
    }),
  );
  input.context.bindings.register(input.module.file, input.name, identity);
  return { identity, added: true };
};

/** Every name an argument mentions, so that `readSettings(c.env.EVENTS_DB)` is read as reaching the binding. */
const namesIn = (argument: ArgumentFact): readonly string[] => {
  switch (argument.kind) {
    case 'identifier':
      return [argument.name];
    case 'member':
      return argument.path;
    case 'call':
      return [...argument.path, ...argument.args.flatMap(namesIn)];
    case 'array':
      return argument.items.flatMap(namesIn);
    case 'object':
      return argument.entries.flatMap((entry) => namesIn(entry.value));
    default:
      return [];
  }
};

const usesBinding = (
  module: ModuleFacts,
  name: string,
): readonly {
  readonly location: ModuleFacts['calls'][number]['location'];
  readonly enclosing: string | undefined;
  readonly enclosingUnresolved: boolean;
}[] =>
  module.calls
    .filter(
      (call) => call.calleePath.includes(name) || call.args.some((a) => namesIn(a).includes(name)),
    )
    .map((call) => ({
      location: call.location,
      enclosing: call.enclosing,
      enclosingUnresolved: call.enclosingUnresolved === true,
    }));

export const workersBindingsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  // A deployment manifest is a convention of the platform, not a package the repository depends on.
  packages: [],
  appliesTo: (context) => context.configs.some(isWorkersManifest),
  discover: (context, builder): AdapterFindings => {
    const files = new Set<string>();
    let components = 0;
    let edges = 0;
    let unresolvedCallers = 0;

    const bindings = context.configs.filter(isWorkersManifest).flatMap(bindingsOf);
    for (const binding of bindings) {
      files.add(binding.configFile);
      builder.addComponent(
        drafts.configComponent({
          kind: binding.kind.componentKind,
          identity: binding.identity,
          configFile: binding.configFile,
          pointer: binding.pointer,
          name: binding.resource,
          value: binding.binding,
          permissions: [
            {
              kind: binding.kind.componentKind === 'queue' ? 'network' : 'database',
              scope: binding.resource,
              mode: 'write',
            },
          ],
          metadata: { binding: binding.binding, service: binding.kind.service },
          tags: [binding.kind.tag],
        }),
      );
      components += 1;
    }

    for (const module of context.modules) {
      if (isTestFile(module.file)) continue;
      for (const binding of bindings) {
        for (const use of usesBinding(module, binding.binding)) {
          if (use.enclosingUnresolved) {
            files.add(module.file);
            unresolvedCallers += 1;
            continue;
          }
          const caller = ensureCaller({
            module,
            context,
            builder,
            name: use.enclosing ?? 'module-scope',
            location: use.location,
          });
          if (caller.added) components += 1;
          builder.addEdge(
            drafts.edge({
              kind: binding.kind.edgeKind,
              from: caller.identity,
              to: binding.identity,
              location: use.location,
              symbol: binding.binding,
              /*
               * Naming a binding is evidence that this code reaches the resource. It is not evidence of the operation,
               * so the relation carries the reach and claims nothing about what was done there.
               */
              confidence: CONFIDENCE_BANDS.structural,
              metadata: { binding: binding.binding },
            }),
          );
          files.add(module.file);
          edges += 1;
        }
      }
    }

    return {
      componentsFound: components,
      edgesFound: edges,
      filesInspected: [...files],
      ...(unresolvedCallers === 0
        ? {}
        : {
            note: `${unresolvedCallers} platform binding ${unresolvedCallers === 1 ? 'use sits' : 'uses sit'} inside a callable whose owner this build cannot name, so no caller component or relation was inferred.`,
          }),
    };
  },
};
