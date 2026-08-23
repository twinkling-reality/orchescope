import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type { ArgumentFact, CallFact, ImportFact, ModuleFacts } from '@orchescope/source-analysis';
import {
  dotted,
  findEntry,
  numberValue,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type {
  AdapterApplicability,
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';
import { definitionForCall, hasBindingAt, matchRuntimeSymbol, moduleMatches } from '../matching.ts';
import {
  clientTimeoutMs,
  type DeclaredDeadline,
  deadlineOfRelation,
  deadlineOnRelation,
  modelCallDeadline,
} from '../model-deadline.ts';
import { registerPromptEntries } from '../prompt-input.ts';
import { type ResolvedSourceValue, resolveSourceValue } from '../source-value.ts';
import { discoverLangChainOpenAiModels } from './langchain-openai-chat-model.ts';
import {
  chatOpenAiApplicability,
  LANGCHAIN_OPENAI_PACKAGES,
} from './langchain-openai-chat-model-origin.ts';

/**
 * Raw model SDK usage.
 *
 * The plain provider clients out-download every agent framework by an order of magnitude, so a system
 * built as a hand written loop over `openai` or `anthropic` has to be discovered or the graph will look
 * empty on the most common shape there is. The call sites are recognised by their documented method
 * paths, and the caller is attributed to the enclosing function, which is the honest limit of what
 * syntax alone can establish.
 */

const PROVIDERS = [
  {
    provider: 'openai',
    packages: ['openai', '@ai-sdk/openai'],
    clients: ['OpenAI', 'AzureOpenAI', 'AsyncOpenAI', 'AsyncAzureOpenAI'],
    methods: [
      'chat.completions.create',
      'responses.create',
      'completions.create',
      'embeddings.create',
      'beta.chat.completions.parse',
      'responses.stream',
    ],
  },
  {
    provider: 'anthropic',
    packages: ['@anthropic-ai/sdk', 'anthropic'],
    clients: ['Anthropic', 'AsyncAnthropic', 'AnthropicBedrock'],
    methods: ['messages.create', 'messages.stream', 'beta.messages.create', 'completions.create'],
  },
  {
    provider: 'google',
    packages: ['@google/genai', 'google.genai', 'google-genai', 'google.generativeai'],
    clients: ['GoogleGenAI', 'Client'],
    methods: ['models.generateContent', 'models.generateContentStream', 'generate_content'],
  },
] as const;

const LANGCHAIN_OLLAMA_PACKAGES = ['langchain_ollama'] as const;
const ALL_PACKAGES = [
  ...PROVIDERS.flatMap((entry) => [...entry.packages]),
  ...LANGCHAIN_OLLAMA_PACKAGES,
  ...LANGCHAIN_OPENAI_PACKAGES,
];
const ADAPTER_ID = 'adapter:model-sdk';
const drafts = createDrafts(ADAPTER_ID);

const providerIdentity = (provider: string): ComponentIdentity =>
  globalIdentity('provider', GLOBAL_NAMESPACES.provider, provider);

const modelIdentity = (provider: string, model: string): ComponentIdentity =>
  globalIdentity('model', GLOBAL_NAMESPACES.model, `${provider}/${model}`);

/** Matches a call path against a provider method suffix, ignoring the client variable name. */
const matchesMethod = (call: CallFact, methods: readonly string[]): string | undefined => {
  const path = dotted(call.calleePath);
  for (const method of methods) {
    if (path === method || path.endsWith(`.${method}`)) return method;
  }
  return undefined;
};

type Discovered = {
  componentKeys: Set<string>;
  edgeKeys: Set<string>;
  files: Set<string>;
  unresolved: TopologyDiscovery['unresolved'][number][];
};

const populationIdentityKey = (identity: ComponentIdentity): string =>
  `${identity.kind}:${identity.namespace}:${identity.localName}`;

const recordComponent = (found: Discovered, identity: ComponentIdentity): void => {
  found.componentKeys.add(populationIdentityKey(identity));
};

const recordEdge = (
  found: Discovered,
  kind: string,
  from: ComponentIdentity,
  to: ComponentIdentity,
): void => {
  found.edgeKeys.add(`${kind}:${populationIdentityKey(from)}->${populationIdentityKey(to)}`);
};

type Wrapper = {
  readonly provider: 'ollama' | 'lmstudio';
  readonly symbol: string;
  readonly applicability: AdapterApplicability[number];
  readonly supportingLocations: readonly SourceLocation[];
};

const importForRoot = (module: ModuleFacts, root: string): ImportFact | undefined => {
  const matches = module.imports.filter((entry) => entry.local === root && !entry.isType);
  return matches.length === 1 ? matches[0] : undefined;
};

const locationEndsBefore = (declaration: SourceLocation, use: SourceLocation): boolean => {
  const endLine = declaration.endLine ?? declaration.startLine;
  if (endLine !== use.startLine) return endLine < use.startLine;
  if (declaration.endColumn === undefined || use.startColumn === undefined) return false;
  return declaration.endColumn <= use.startColumn;
};

const compareLocationStart = (left: SourceLocation, right: SourceLocation): number =>
  left.startLine - right.startLine || (left.startColumn ?? -1) - (right.startColumn ?? -1);

const callableImportOwnsUse = (
  module: ModuleFacts,
  entry: ImportFact,
  use: SourceLocation,
): boolean => {
  if (entry.enclosing === undefined) return true;
  return module.definitions.some(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      (definition.name === entry.enclosing || definition.name.endsWith(`.${entry.enclosing}`)) &&
      locationContains(definition.location, entry.location) &&
      locationContains(definition.location, use),
  );
};

/** The exact import binding that owns one provider construction at its lexical use. */
const importForProviderCall = (module: ModuleFacts, call: CallFact): ImportFact | undefined => {
  const root = call.calleePath[0];
  if (root === undefined || call.origin === undefined) return undefined;
  const sameBinding = module.imports.filter(
    (entry) =>
      entry.local === root &&
      !entry.isType &&
      entry.module === call.origin?.module &&
      entry.imported === call.origin.imported,
  );
  const containingLocalImport = sameBinding.some(
    (entry) => entry.enclosing !== undefined && callableImportOwnsUse(module, entry, call.location),
  );
  const candidates = sameBinding.filter(
    (entry) =>
      locationEndsBefore(entry.location, call.location) &&
      callableImportOwnsUse(module, entry, call.location) &&
      (entry.enclosing !== undefined || !containingLocalImport),
  );
  return candidates.sort((left, right) => {
    if (left.enclosing === undefined && right.enclosing !== undefined) return 1;
    if (left.enclosing !== undefined && right.enclosing === undefined) return -1;
    return compareLocationStart(right.location, left.location);
  })[0];
};

const applicabilityRow = (
  entry: ImportFact,
  imported = entry.imported,
): AdapterApplicability[number] => ({
  module: entry.module,
  imported,
  location: entry.location,
});

const DEFAULT_CLIENT_EXPORTS = new Map<string, readonly string[]>([
  ['openai', ['OpenAI']],
  ['@anthropic-ai/sdk', ['Anthropic']],
]);

const defaultClientExports = (moduleSpecifier: string): readonly string[] =>
  DEFAULT_CLIENT_EXPORTS.get(moduleSpecifier) ?? [];

/** A local ChatLMStudio whose single class declaration extends exact langchain_openai.ChatOpenAI. */
const localLmStudioWrapper = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): Wrapper | undefined => {
  const root = call.calleePath[0];
  if (root === undefined) return undefined;
  const resolved = context.symbols.resolve(module.file, root);
  if (resolved?.definition?.kind !== 'class' || resolved.definition.name !== 'ChatLMStudio') {
    return undefined;
  }
  const declarations = context.symbols
    .definitionsOf(resolved.file)
    .filter(
      (definition) => definition.kind === 'class' && definition.name === resolved.definition?.name,
    );
  if (declarations.length !== 1) return undefined;
  const definingModule = context.symbols.moduleOf(resolved.file);
  if (definingModule === undefined) return undefined;
  const wrapperDefinition = resolved.definition;
  const bases = wrapperDefinition.initializer ?? [];
  const matchedBase = bases
    .map((base) => {
      const path = base.split('.');
      const rootName = path[0];
      if (rootName === undefined) return undefined;
      const imported = importForRoot(definingModule, rootName);
      if (imported === undefined) return undefined;
      const matched = matchRuntimeSymbol(
        context.modules,
        definingModule,
        {
          path,
          origin: {
            module: imported.module,
            imported: imported.imported,
            isType: imported.isType,
          },
          enclosing: wrapperDefinition.name,
          location: wrapperDefinition.location,
        },
        { names: ['ChatOpenAI'], packages: LANGCHAIN_OPENAI_PACKAGES },
      );
      return matched === undefined ? undefined : imported;
    })
    .find((entry) => entry !== undefined);
  if (matchedBase === undefined) return undefined;
  const applicationImport = importForRoot(module, root);
  return {
    provider: 'lmstudio',
    symbol: 'ChatLMStudio',
    applicability: applicabilityRow(applicationImport ?? matchedBase, 'ChatLMStudio'),
    supportingLocations: [resolved.definition.location, matchedBase.location],
  };
};

const wrapperAt = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): Wrapper | undefined => {
  const ollama = matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: ['ChatOllama'], packages: LANGCHAIN_OLLAMA_PACKAGES },
  );
  if (ollama !== undefined) {
    const root = call.calleePath[0];
    const imported = root === undefined ? undefined : importForRoot(module, root);
    if (imported === undefined) return undefined;
    return {
      provider: 'ollama',
      symbol: 'ChatOllama',
      applicability: applicabilityRow(imported, 'ChatOllama'),
      supportingLocations: [imported.location],
    };
  }
  return localLmStudioWrapper(context, module, call);
};

const directWrapperImports = (context: DiscoveryContext): AdapterApplicability => {
  const rows: AdapterApplicability[number][] = [];
  const local = localModules(context.modules);
  for (const module of context.modules) {
    for (const entry of module.imports) {
      if (
        !entry.isType &&
        entry.imported === 'ChatOllama' &&
        moduleMatches(entry.module, LANGCHAIN_OLLAMA_PACKAGES) &&
        !namesLocalModule(local, module, entry.module)
      ) {
        rows.push(applicabilityRow(entry));
      }
    }
    for (const call of module.calls) {
      const wrapper = wrapperAt(context, module, call);
      if (wrapper !== undefined) rows.push(wrapper.applicability);
    }
  }
  return [...new Map(rows.map((row) => [applicabilityKey(row), row])).values()];
};

const rawProviderImports = (context: DiscoveryContext): AdapterApplicability => {
  const local = localModules(context.modules);
  const importRows = context.modules.flatMap((module) =>
    module.imports.flatMap((entry) => {
      if (entry.isType || namesLocalModule(local, module, entry.module)) return [];
      const supported = PROVIDERS.some(
        (provider) =>
          moduleMatches(entry.module, provider.packages) &&
          (provider.clients.includes(entry.imported as never) ||
            (entry.imported === 'default' && defaultClientExports(entry.module).length > 0)),
      );
      return supported ? [applicabilityRow(entry)] : [];
    }),
  );
  const callRows = context.modules.flatMap((module) =>
    module.calls.flatMap((call) => {
      const supported = PROVIDERS.some(
        (provider) =>
          matchRuntimeSymbol(
            context.modules,
            module,
            {
              path: call.calleePath,
              origin: call.origin,
              enclosing: call.enclosing,
              location: call.location,
            },
            {
              names: provider.clients,
              packages: provider.packages,
              defaultExportNames: defaultClientExports(call.origin?.module ?? ''),
            },
          ) !== undefined,
      );
      const imported = supported ? importForProviderCall(module, call) : undefined;
      return imported === undefined
        ? []
        : [
            applicabilityRow(
              imported,
              imported.imported === '*' ? call.calleePath.at(-1) : imported.imported,
            ),
          ];
    }),
  );
  return [...importRows, ...callRows];
};

const applicabilityKey = (row: AdapterApplicability[number]): string =>
  `${row.location.file}:${row.location.startLine}:${row.location.startColumn ?? 0}:${row.location.endLine ?? row.location.startLine}:${row.location.endColumn ?? 0}:${row.module}:${row.imported}`;

const distinctApplicability = (rows: AdapterApplicability): AdapterApplicability => [
  ...new Map(rows.map((row) => [applicabilityKey(row), row])).values(),
];

const legacyModelSdkApplicability = (context: DiscoveryContext): AdapterApplicability =>
  distinctApplicability([...rawProviderImports(context), ...directWrapperImports(context)]);

const modelSdkApplicability = (context: DiscoveryContext): AdapterApplicability => {
  const rows = [...legacyModelSdkApplicability(context), ...chatOpenAiApplicability(context)];
  return [...new Map(rows.map((row) => [applicabilityKey(row), row])).values()];
};

const modelSdkTopology = (input: {
  readonly context: DiscoveryContext;
  readonly relations: number;
  readonly direct: ReturnType<typeof discoverLangChainOpenAiModels>['topology'];
  readonly rawUnresolved: TopologyDiscovery['unresolved'];
}): TopologyDiscovery => {
  const legacy = legacyModelSdkApplicability(input.context);
  const unresolved = [...input.direct.unresolved, ...input.rawUnresolved];
  for (const row of legacy) {
    if (unresolved.length >= 10) break;
    unresolved.push({
      kind: 'adapter_input',
      reason:
        'adapter:model-sdk recognized a raw client or wrapper but has not stated a closed topology population for that producer.',
      location: row.location,
    });
  }
  return {
    status: input.direct.status === 'incomplete' || legacy.length > 0 ? 'incomplete' : 'complete',
    inspectedInputs: modelSdkApplicability(input.context).length,
    explicitRelations: input.relations,
    conditionalConstructs: 0,
    conditionalDestinations: 0,
    entryBoundaries: 0,
    entryTargets: [],
    terminalBoundaries: 0,
    boundaryFacts: [],
    configurationBounds: 0,
    configurationBoundFacts: [],
    unresolvedCount: input.direct.unresolvedCount + input.rawUnresolved.length + legacy.length,
    unresolved,
  };
};

/** The variable a construction was assigned to, which is the name every later call reaches it by. */
const variableHolding = (
  module: ModuleFacts,
  call: CallFact,
):
  | {
      readonly name: string;
      readonly enclosing: string | undefined;
      readonly location: SourceLocation;
      readonly unique: boolean;
      readonly branches: NonNullable<CallFact['branches']>;
    }
  | undefined => {
  const definition = definitionForCall(module, call);
  if (definition?.kind !== 'variable') {
    const assignment = module.assignments.find(
      (candidate) =>
        candidate.target.length === 1 && locationContains(candidate.location, call.location),
    );
    const name = assignment?.target[0];
    if (assignment === undefined || name === undefined) return undefined;
    return {
      name,
      enclosing: assignment.enclosing,
      location: assignment.location,
      unique: false,
      branches: call.branches ?? [],
    };
  }
  const definitions = module.definitions.filter(
    (candidate) =>
      candidate.kind === 'variable' &&
      candidate.name === definition.name &&
      candidate.enclosing === definition.enclosing,
  );
  return {
    name: definition.name,
    enclosing: definition.enclosing,
    location: definition.location,
    unique: definitions.length === 1,
    branches: definition.branches ?? [],
  };
};

const receiverKey = (enclosing: string | undefined, receiver: string): string =>
  `${enclosing ?? '<module>'}:${receiver}`;

type ProviderClient = {
  readonly provider: (typeof PROVIDERS)[number];
  readonly providerResolved: boolean;
  readonly deadline: number | undefined;
  readonly supportingLocations: readonly SourceLocation[];
  readonly bindingLocation: SourceLocation;
  readonly bindingBranches: NonNullable<CallFact['branches']>;
};

const sameBranch = (
  left: NonNullable<CallFact['branches']>[number],
  right: NonNullable<CallFact['branches']>[number],
): boolean =>
  left.branch === right.branch &&
  left.location.file === right.location.file &&
  left.location.startLine === right.location.startLine &&
  left.location.startColumn === right.location.startColumn;

/** A binding is authoritative only inside every conditional branch that created it. */
const bindingOwnsUse = (
  binding: NonNullable<CallFact['branches']>,
  use: NonNullable<CallFact['branches']>,
): boolean => {
  if (binding.length > use.length) return false;
  return binding.every((branch, index) => {
    const usedBranch = use[index];
    return usedBranch !== undefined && sameBranch(branch, usedBranch);
  });
};

const registerProviderClientAt = (input: {
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly provider: (typeof PROVIDERS)[number];
  readonly builder: SystemGraphBuilder;
  readonly context: DiscoveryContext;
  readonly found: Discovered;
}): { readonly key: string; readonly client: ProviderClient } | undefined => {
  const { module, call, provider, builder, context, found } = input;
  const matched = matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    {
      names: provider.clients,
      packages: provider.packages,
      defaultExportNames: defaultClientExports(call.origin?.module ?? ''),
    },
  );
  if (matched === undefined) return undefined;
  const entries = objectArgument(call);
  const timeout = clientTimeoutMs(call, module.language);
  const baseUrlEntry = findEntry(entries, 'baseURL') ?? findEntry(entries, 'base_url');
  const baseUrlFromConfig =
    stringValue(findEntry(entries, 'baseURL')?.value) ??
    stringValue(findEntry(entries, 'base_url')?.value);
  const providerResolved = baseUrlEntry === undefined || baseUrlFromConfig !== undefined;
  const metadata = {
    client: dotted(call.calleePath),
    ...(baseUrlFromConfig === undefined ? {} : { baseUrl: baseUrlFromConfig }),
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
  };
  const imported = importForProviderCall(module, call);
  if (providerResolved) {
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'provider',
        identity: providerIdentity(provider.provider),
        file: module.file,
        name: provider.provider,
        location: call.location,
        symbol: dotted(call.calleePath),
        confidence: CONFIDENCE_BANDS.deterministic,
        permissions: [
          { kind: 'network', scope: baseUrlFromConfig ?? provider.provider, mode: 'write' },
        ],
        metadata,
        tags: ['model-sdk'],
      }),
    );
    if (imported !== undefined) {
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'provider',
          identity: providerIdentity(provider.provider),
          file: imported.location.file,
          name: provider.provider,
          location: imported.location,
          symbol: `${imported.module}.${imported.imported}`,
          confidence: CONFIDENCE_BANDS.deterministic,
          permissions: [
            { kind: 'network', scope: baseUrlFromConfig ?? provider.provider, mode: 'write' },
          ],
          metadata,
          tags: ['model-sdk'],
        }),
      );
    }
    recordComponent(found, providerIdentity(provider.provider));
  } else {
    found.unresolved.push({
      kind: 'adapter_input',
      reason: `${dotted(call.calleePath)} receives a base URL whose provider identity is selected at run time.`,
      location: baseUrlEntry?.location ?? call.location,
    });
  }
  found.files.add(module.file);
  const definition = variableHolding(module, call);
  if (definition === undefined) return undefined;
  if (providerResolved && definition.unique) {
    context.bindings.register(module.file, definition.name, providerIdentity(provider.provider));
  }
  return {
    key: receiverKey(definition.enclosing, definition.name),
    client: {
      provider,
      providerResolved,
      deadline: timeout,
      supportingLocations: [...(imported === undefined ? [] : [imported.location]), call.location],
      bindingLocation: definition.location,
      bindingBranches: definition.branches,
    },
  };
};

/**
 * The deadline each client variable in one module was constructed with.
 *
 * Resolved within the module that constructs the client and no further. A repository that builds its
 * client once and hands it to whatever needs it, which is how the larger Python applications are
 * written, gives a call site no syntactic route back to the construction, and following a constructor
 * parameter across files would be an answer the source has not settled. Where the client cannot be
 * resolved this contributes nothing, the relation carries no deadline, and the rule keeps saying so.
 */
const registerProviderClients = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  context: DiscoveryContext,
  found: Discovered,
): ReadonlyMap<string, readonly ProviderClient[]> => {
  const clients = new Map<string, ProviderClient[]>();
  for (const provider of PROVIDERS) {
    for (const call of module.calls) {
      const registered = registerProviderClientAt({
        module,
        call,
        provider,
        builder,
        context,
        found,
      });
      if (registered !== undefined) {
        const existing = clients.get(registered.key);
        if (existing === undefined) clients.set(registered.key, [registered.client]);
        else existing.push(registered.client);
      }
    }
  }
  return clients;
};

/** The name a call reaches its client by, which is the callee path with the method suffix removed. */
const clientReceiver = (call: CallFact, method: string): string =>
  dotted(call.calleePath.slice(0, call.calleePath.length - method.split('.').length));

type ModelCall = {
  readonly call: CallFact;
  readonly provider: (typeof PROVIDERS)[number];
  readonly providerResolved: boolean;
  readonly method: string;
  readonly model: string;
  readonly deadline: DeclaredDeadline | undefined;
  readonly supportingLocations: readonly SourceLocation[];
};

type ClientSettlement = {
  readonly receiver: string;
  readonly client?: ProviderClient;
  readonly refusal?: string;
  readonly agentBoundary?: boolean;
};

const sameLocationStart = (left: SourceLocation, right: SourceLocation): boolean =>
  compareLocationStart(left, right) === 0;

const everyReceiverBindingIsRecognized = (input: {
  readonly module: ModuleFacts;
  readonly receiver: string;
  readonly enclosing: string | undefined;
  readonly call: CallFact;
  readonly candidates: readonly ProviderClient[];
}): boolean => {
  const { module, receiver, enclosing, call, candidates } = input;
  // A conditional member assignment does not establish what the object held on
  // paths that bypass it. The pre-existing member may be an arbitrary client.
  if (receiver.includes('.')) return false;
  const parameterBinding = module.definitions.some(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      definition.parameters?.some((parameter) => parameter.name === receiver) === true &&
      (definition.name === enclosing || definition.name.endsWith(`.${enclosing}`)) &&
      locationContains(definition.location, call.location),
  );
  if (parameterBinding) return false;
  const bindingLocations = [
    ...module.definitions
      .filter(
        (definition) =>
          definition.kind === 'variable' &&
          definition.name === receiver &&
          definition.enclosing === enclosing &&
          locationEndsBefore(definition.location, call.location),
      )
      .map((definition) => definition.location),
    ...module.assignments
      .filter(
        (assignment) =>
          assignment.target.length === 1 &&
          assignment.target[0] === receiver &&
          assignment.enclosing === enclosing &&
          locationEndsBefore(assignment.location, call.location),
      )
      .map((assignment) => assignment.location),
  ];
  return (
    bindingLocations.length > 0 &&
    bindingLocations.every((binding) =>
      candidates.some((candidate) => sameLocationStart(candidate.bindingLocation, binding)),
    )
  );
};

const settleClientAt = (input: {
  readonly module: ModuleFacts;
  readonly clients: ReadonlyMap<string, readonly ProviderClient[]>;
  readonly call: CallFact;
  readonly method: string;
  readonly provider: (typeof PROVIDERS)[number];
}): ClientSettlement => {
  const { module, clients, call, method, provider } = input;
  const receiver = clientReceiver(call, method);
  const callBranches = call.branches ?? [];
  const enclosing = hasBindingAt(module, call.enclosing, receiver, call.location)
    ? call.enclosing
    : undefined;
  const unsettledAssignment =
    module.language !== 'python' &&
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === receiver &&
        assignment.enclosing === enclosing &&
        locationEndsBefore(assignment.location, call.location),
    );
  const nearestDefinition = module.definitions
    .filter(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === receiver &&
        definition.enclosing === enclosing &&
        locationEndsBefore(definition.location, call.location) &&
        bindingOwnsUse(definition.branches ?? [], callBranches),
    )
    .sort((left, right) => compareLocationStart(right.location, left.location))[0];
  const candidates = clients.get(receiverKey(enclosing, receiver)) ?? [];
  const activeCandidates = candidates.filter(
    (candidate) =>
      locationEndsBefore(candidate.bindingLocation, call.location) &&
      (nearestDefinition === undefined ||
        !locationEndsBefore(candidate.bindingLocation, nearestDefinition.location)),
  );
  const eligible = candidates.filter(
    (candidate) =>
      bindingOwnsUse(candidate.bindingBranches, callBranches) &&
      candidate.bindingLocation.startLine === nearestDefinition?.location.startLine &&
      candidate.bindingLocation.startColumn === nearestDefinition.location.startColumn,
  );
  const client = eligible.length === 1 && !unsettledAssignment ? eligible[0] : undefined;
  const competingBinding =
    client !== undefined &&
    candidates.some(
      (candidate) =>
        candidate !== client &&
        locationEndsBefore(candidate.bindingLocation, call.location) &&
        !locationEndsBefore(candidate.bindingLocation, client.bindingLocation),
    );
  if (client?.provider === provider && !competingBinding) return { receiver, client };
  if (!activeCandidates.some((candidate) => candidate.provider === provider)) return { receiver };
  const refusal = unsettledAssignment
    ? `${receiver} is reassigned before this call, so its provider client is not settled.`
    : activeCandidates.length > 1
      ? `${receiver} may refer to more than one provider client at this control-flow join.`
      : `${receiver} has no provider client settled on every path through this control-flow join.`;
  return {
    receiver,
    refusal,
    ...(everyReceiverBindingIsRecognized({ module, receiver, enclosing, call, candidates })
      ? { agentBoundary: true }
      : {}),
  };
};

const modelCallsIn = (
  module: ModuleFacts,
  clients: ReadonlyMap<string, readonly ProviderClient[]>,
): {
  readonly calls: readonly ModelCall[];
  readonly unresolved: TopologyDiscovery['unresolved'];
  readonly unsettledCallers: readonly CallFact[];
} => {
  const calls: ModelCall[] = [];
  const unresolved: TopologyDiscovery['unresolved'][number][] = [];
  const unsettledCallers: CallFact[] = [];
  const refusedOffsets = new Set<number>();
  for (const call of module.calls) {
    for (const provider of PROVIDERS) {
      const method = matchesMethod(call, provider.methods);
      if (method === undefined) continue;
      const settlement = settleClientAt({ module, clients, call, method, provider });
      if (settlement.client === undefined) {
        if (settlement.agentBoundary === true && call.enclosing !== undefined) {
          unsettledCallers.push(call);
        }
        if (settlement.refusal !== undefined && !refusedOffsets.has(call.offset)) {
          unresolved.push({
            kind: 'conditional_destination',
            reason: settlement.refusal,
            location: call.location,
          });
          refusedOffsets.add(call.offset);
        }
        continue;
      }
      calls.push({
        call,
        provider,
        providerResolved: settlement.client.providerResolved,
        method,
        model: stringValue(findEntry(objectArgument(call), 'model')?.value) ?? 'unspecified',
        deadline: modelCallDeadline(call, module.language, settlement.client.deadline),
        supportingLocations: settlement.client.supportingLocations,
      });
    }
  }
  return { calls, unresolved, unsettledCallers };
};

/**
 * The deadline each relation may claim, keyed by the caller and model it joins.
 *
 * Computed across the module before any edge is written, because a relation stands for every call one
 * function makes to one model and the answer is a property of that set rather than of whichever call
 * was read last.
 */
const relationDeadlines = (calls: readonly ModelCall[]): ReadonlyMap<string, DeclaredDeadline> => {
  const grouped = new Map<string, (DeclaredDeadline | undefined)[]>();
  for (const entry of calls) {
    if (entry.call.enclosing === undefined) continue;
    const key = `${entry.call.enclosing} ${entry.provider.provider}/${entry.model}`;
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [entry.deadline]);
    else bucket.push(entry.deadline);
  }
  const declared = new Map<string, DeclaredDeadline>();
  for (const [key, deadlines] of grouped) {
    const deadline = deadlineOfRelation(deadlines);
    if (deadline !== undefined) declared.set(key, deadline);
  }
  return declared;
};

const registerModelPromptInput = (input: {
  readonly module: ModuleFacts;
  readonly context: DiscoveryContext;
  readonly call: CallFact;
  readonly provider: (typeof PROVIDERS)[number];
  readonly method: string;
  readonly model: string;
  readonly entries: readonly import('@orchescope/source-analysis').ObjectEntryFact[];
  readonly supportingLocations: readonly SourceLocation[];
}): void => {
  const { module, context, call, provider, method, model, entries, supportingLocations } = input;
  const consumer =
    call.enclosing === undefined
      ? modelIdentity(provider.provider, model)
      : sourceIdentity('agent', module.file, call.enclosing);
  const channels = method.includes('embeddings')
    ? []
    : method.includes('responses')
      ? ['instructions', 'input']
      : method.includes('messages') || method.includes('chat.completions')
        ? ['system', 'messages']
        : method.includes('generateContent') || method.includes('generate_content')
          ? ['contents']
          : ['prompt'];
  registerPromptEntries({
    registry: context.promptInputs,
    producer: ADAPTER_ID,
    module,
    call,
    consumer,
    entries,
    channels,
    supportingLocations: [...supportingLocations, call.location],
  });
  if (
    channels.includes('contents') &&
    findEntry(entries, 'contents') === undefined &&
    call.args[0] !== undefined &&
    call.args[0].kind !== 'object'
  ) {
    context.promptInputs.register({
      producer: ADAPTER_ID,
      module,
      call,
      consumer,
      channel: 'contents',
      value: call.args[0],
      location: call.location,
      supportingLocations: [...supportingLocations, call.location],
    });
  }
};

/** A supported model call whose runtime endpoint cannot justify a provider or model identity. */
const registerUnresolvedModelCaller = (input: {
  readonly module: ModuleFacts;
  readonly builder: SystemGraphBuilder;
  readonly found: Discovered;
  readonly call: CallFact;
  readonly boundary?: string;
}): void => {
  const { module, builder, found, call, boundary } = input;
  const enclosing = call.enclosing;
  if (enclosing === undefined) return;
  const callerIdentity = sourceIdentity('agent', module.file, enclosing);
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'agent',
      file: module.file,
      name: enclosing,
      location: call.location,
      symbol: enclosing,
      confidence: CONFIDENCE_BANDS.heuristic,
      details: { for: 'agent', role: 'unspecified', framework: 'hand-written' },
      metadata: {
        inferredFrom: 'model call site',
        modelBoundary: boundary ?? 'provider and model selected at run time',
      },
      tags: ['hand-written-loop'],
    }),
  );
  recordComponent(found, callerIdentity);
  found.files.add(module.file);
};

const registerUnsettledModelCallers = (input: {
  readonly module: ModuleFacts;
  readonly builder: SystemGraphBuilder;
  readonly found: Discovered;
  readonly calls: readonly CallFact[];
}): void => {
  for (const call of input.calls) {
    registerUnresolvedModelCaller({
      module: input.module,
      builder: input.builder,
      found: input.found,
      call,
      boundary: 'provider identity unsettled across client control flow',
    });
  }
};

const registerModelCalls = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  context: DiscoveryContext,
  found: Discovered,
  clients: ReadonlyMap<string, readonly ProviderClient[]>,
): void => {
  const discovered = modelCallsIn(module, clients);
  const modelCalls = discovered.calls;
  found.unresolved.push(
    ...discovered.unresolved.slice(0, Math.max(0, 10 - found.unresolved.length)),
  );
  registerUnsettledModelCallers({ module, builder, found, calls: discovered.unsettledCallers });
  const declared = relationDeadlines(modelCalls);
  for (const {
    call,
    provider,
    providerResolved,
    method,
    model,
    supportingLocations,
  } of modelCalls) {
    const entries = objectArgument(call);
    const maxTokens =
      numberValue(findEntry(entries, 'max_tokens')?.value) ??
      numberValue(findEntry(entries, 'maxTokens')?.value) ??
      numberValue(findEntry(entries, 'max_output_tokens')?.value);
    const temperature = numberValue(findEntry(entries, 'temperature')?.value);
    const streaming = method.includes('stream') || findEntry(entries, 'stream') !== undefined;
    if (providerResolved || call.enclosing !== undefined) {
      registerModelPromptInput({
        module,
        context,
        call,
        provider,
        method,
        model,
        entries,
        supportingLocations,
      });
    }
    if (!providerResolved) {
      registerUnresolvedModelCaller({ module, builder, found, call });
      continue;
    }

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'model',
        identity: modelIdentity(provider.provider, model),
        file: module.file,
        name: `${provider.provider}/${model}`,
        location: call.location,
        symbol: dotted(call.calleePath),
        confidence: CONFIDENCE_BANDS.deterministic,
        details: {
          for: 'model',
          provider: provider.provider,
          modelId: model,
          streaming,
          ...(temperature === undefined ? {} : { temperature }),
          ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
        },
        metadata: { callSite: dotted(call.calleePath), operation: method },
        tags: ['model-sdk'],
      }),
    );
    for (const evidenceLocation of supportingLocations) {
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'model',
          identity: modelIdentity(provider.provider, model),
          file: evidenceLocation.file,
          name: `${provider.provider}/${model}`,
          location: evidenceLocation,
          symbol: `${provider.provider} client binding`,
          confidence: CONFIDENCE_BANDS.deterministic,
          details: {
            for: 'model',
            provider: provider.provider,
            modelId: model,
            streaming,
            ...(temperature === undefined ? {} : { temperature }),
            ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
          },
          metadata: { callSite: dotted(call.calleePath), operation: method },
          tags: ['model-sdk'],
        }),
      );
    }
    const modelComponent = modelIdentity(provider.provider, model);
    recordComponent(found, modelComponent);
    found.files.add(module.file);
    /*
     * What this call site produced, for whatever asks later what a line of code reaches.
     *
     * The index is documented as complete and this adapter had never written to it, so a retry around
     * `client.embeddings.create(...)` resolved to nothing: the callee is a method path no binding stands
     * for, and the model component it produced was recorded nowhere a second reader could find it. Three
     * retry rules reported that no retry had been examined on a repository that wraps fifteen attempts
     * around exactly that call.
     *
     * No effect class travels with it. A model invocation is not a write and nobody has classified it,
     * and absent is the answer that says so.
     */
    context.callSiteEffects.record(module.file, call, modelIdentity(provider.provider, model));

    builder.addEdge(
      drafts.edge({
        kind: 'served_by_provider',
        from: modelIdentity(provider.provider, model),
        to: providerIdentity(provider.provider),
        location: call.location,
        symbol: dotted(call.calleePath),
      }),
    );
    recordEdge(found, 'served_by_provider', modelComponent, providerIdentity(provider.provider));

    // The caller is attributed to its enclosing function, recorded as an entry point when the
    // repository has no framework declared agent to attach the call to.
    const enclosing = call.enclosing;
    if (enclosing !== undefined) {
      const callerIdentity = sourceIdentity('agent', module.file, enclosing);
      const deadline = declared.get(`${enclosing} ${provider.provider}/${model}`);
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'agent',
          file: module.file,
          name: enclosing,
          location: call.location,
          symbol: enclosing,
          confidence: CONFIDENCE_BANDS.heuristic,
          details: { for: 'agent', role: 'unspecified', framework: 'hand-written' },
          metadata: { inferredFrom: 'model call site' },
          tags: ['hand-written-loop'],
        }),
      );
      recordComponent(found, callerIdentity);
      builder.addEdge(
        drafts.edge({
          kind: 'invokes_model',
          from: callerIdentity,
          to: modelIdentity(provider.provider, model),
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: CONFIDENCE_BANDS.structural,
          ...deadlineOnRelation(deadline),
        }),
      );
      recordEdge(found, 'invokes_model', callerIdentity, modelComponent);
    }
  }
};

const locationContains = (outer: SourceLocation, inner: SourceLocation): boolean => {
  const outerEnd = outer.endLine ?? outer.startLine;
  const innerEnd = inner.endLine ?? inner.startLine;
  return inner.startLine >= outer.startLine && innerEnd <= outerEnd;
};

/**
 * A literal fallback supplied to Python's environment readers.
 *
 * The environment may select another value at runtime, so this is a configuration default rather than
 * an exact binding. The nested call has to resolve to the Python `os` module: a local `getenv` or an
 * object with a same-named method cannot establish a model identity.
 */
const environmentStringDefault = (
  context: DiscoveryContext,
  module: ModuleFacts,
  outerCall: CallFact,
  value: ArgumentFact,
): ResolvedSourceValue | undefined => {
  if (module.language !== 'python' || value.kind !== 'call') return undefined;
  const environmentName = stringValue(value.args[0]);
  const fallback = value.args[1];
  if (environmentName === undefined || fallback?.kind !== 'string') return undefined;
  const path = dotted(value.path);
  if (!['os.getenv', 'os.environ.get', 'environ.get', 'getenv'].includes(path)) return undefined;
  const importedNames =
    path === 'os.environ.get' ? ['get'] : path === 'environ.get' ? ['environ'] : ['getenv'];
  const candidates = module.calls.filter(
    (candidate) =>
      dotted(candidate.calleePath) === path &&
      candidate.enclosing === outerCall.enclosing &&
      locationContains(outerCall.location, candidate.location) &&
      stringValue(candidate.args[0]) === environmentName &&
      stringValue(candidate.args[1]) === fallback.value &&
      matchRuntimeSymbol(
        context.modules,
        module,
        {
          path: candidate.calleePath,
          origin: candidate.origin,
          enclosing: candidate.enclosing,
          location: candidate.location,
        },
        { names: importedNames, packages: ['os'] },
      )?.resolved === true,
  );
  if (candidates.length === 0) return undefined;
  return {
    value: fallback,
    basis: 'configuration_default',
    locations: candidates.map((candidate) => candidate.location),
  };
};

const stringResolution = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact | undefined,
): ResolvedSourceValue | undefined => {
  if (value === undefined) return undefined;
  const environmentDefault = environmentStringDefault(context, module, call, value);
  if (environmentDefault !== undefined) return environmentDefault;
  const resolved = resolveSourceValue({
    context,
    module,
    value,
    before: call.location,
    enclosing: call.enclosing,
  });
  return resolved?.value.kind === 'string' ? resolved : undefined;
};

const providerDefault = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  modelValue: ArgumentFact | undefined,
): ResolvedSourceValue | undefined => {
  if (modelValue?.kind !== 'member') return undefined;
  const root = modelValue.path[0];
  if (root === undefined) return undefined;
  return stringResolution(context, module, call, {
    kind: 'member',
    path: [root, 'llm_provider'],
  });
};

const addWrapperEvidence = (input: {
  readonly builder: SystemGraphBuilder;
  readonly found: Discovered;
  readonly wrapper: Wrapper;
  readonly call: CallFact;
  readonly module: ModuleFacts;
  readonly model: string;
  readonly modelResolution: ResolvedSourceValue;
  readonly providerResolution: ResolvedSourceValue | undefined;
}): ComponentIdentity => {
  const { builder, found, wrapper, call, module, modelResolution } = input;
  const provider = providerIdentity(wrapper.provider);
  const identity = modelIdentity(wrapper.provider, input.model);
  const providerDefaultValue =
    input.providerResolution?.value.kind === 'string'
      ? input.providerResolution.value.value
      : undefined;
  const defaultSelection =
    modelResolution.basis === 'configuration_default' &&
    (providerDefaultValue === undefined || providerDefaultValue === wrapper.provider);
  const metadata = {
    framework: 'langchain',
    configurationSelection: 'possible',
    configurationDefault: defaultSelection,
    modelValueBasis:
      modelResolution.basis === 'configuration_default' ? 'static_default' : 'literal',
  } as const;

  builder.addComponent(
    drafts.sourceComponent({
      kind: 'provider',
      identity: provider,
      file: module.file,
      name: wrapper.provider,
      location: call.location,
      symbol: wrapper.symbol,
      confidence: CONFIDENCE_BANDS.deterministic,
      permissions: [{ kind: 'network', scope: wrapper.provider, mode: 'write' }],
      metadata,
      tags: ['model-sdk', 'configuration-possibility'],
    }),
  );
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'model',
      identity,
      file: module.file,
      name: `${wrapper.provider}/${input.model}`,
      displayName: input.model,
      location: call.location,
      symbol: wrapper.symbol,
      confidence: CONFIDENCE_BANDS.deterministic,
      details: {
        for: 'model',
        provider: wrapper.provider,
        modelId: input.model,
        streaming: false,
      },
      metadata,
      tags: ['model-sdk', 'configuration-possibility'],
    }),
  );
  for (const evidenceLocation of [
    ...wrapper.supportingLocations,
    ...modelResolution.locations,
    ...(input.providerResolution?.locations ?? []),
  ]) {
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'model',
        identity,
        file: evidenceLocation.file,
        name: `${wrapper.provider}/${input.model}`,
        displayName: input.model,
        location: evidenceLocation,
        symbol: `${wrapper.symbol} configuration path`,
        confidence: CONFIDENCE_BANDS.deterministic,
        details: {
          for: 'model',
          provider: wrapper.provider,
          modelId: input.model,
          streaming: false,
        },
        metadata,
        tags: ['model-sdk', 'configuration-possibility'],
      }),
    );
    found.files.add(evidenceLocation.file);
  }
  builder.addEdge(
    drafts.edge({
      kind: 'served_by_provider',
      from: identity,
      to: provider,
      location: call.location,
      symbol: wrapper.symbol,
      confidence: CONFIDENCE_BANDS.deterministic,
    }),
  );
  recordComponent(found, identity);
  recordComponent(found, provider);
  recordEdge(found, 'served_by_provider', identity, provider);
  found.files.add(module.file);
  return identity;
};

/** LangChain chat-model constructions with a deterministic literal or static configuration default. */
const registerLangChainWrappers = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  context: DiscoveryContext,
  found: Discovered,
): void => {
  for (const call of module.calls) {
    const wrapper = wrapperAt(context, module, call);
    if (wrapper === undefined) continue;
    const modelValue = findEntry(objectArgument(call), 'model')?.value;
    const modelResolution = stringResolution(context, module, call, modelValue);
    if (modelResolution?.value.kind !== 'string') continue;
    const identity = addWrapperEvidence({
      builder,
      found,
      wrapper,
      call,
      module,
      model: modelResolution.value.value,
      modelResolution,
      providerResolution: providerDefault(context, module, call, modelValue),
    });
    context.callSiteEffects.record(module.file, call, identity);
  }
};

export const modelSdkAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '4',
  packages: ALL_PACKAGES,
  applicability: modelSdkApplicability,
  appliesTo: (context) => modelSdkApplicability(context).length > 0,
  discover: (context, builder): AdapterFindings => {
    const found: Discovered = {
      componentKeys: new Set(),
      edgeKeys: new Set(),
      files: new Set(),
      unresolved: [],
    };
    for (const module of context.modules) {
      const clientDeadlines = registerProviderClients(module, builder, context, found);
      registerModelCalls(module, builder, context, found, clientDeadlines);
      registerLangChainWrappers(module, builder, context, found);
    }
    const direct = discoverLangChainOpenAiModels(context, builder);
    for (const key of direct.componentKeys) found.componentKeys.add(key);
    for (const key of direct.edgeKeys) found.edgeKeys.add(key);
    for (const file of direct.files) found.files.add(file);
    return {
      componentsFound: found.componentKeys.size,
      edgesFound: found.edgeKeys.size,
      filesInspected: [...found.files],
      topology: modelSdkTopology({
        context,
        relations: found.edgeKeys.size,
        direct: direct.topology,
        rawUnresolved: found.unresolved,
      }),
    };
  },
};
