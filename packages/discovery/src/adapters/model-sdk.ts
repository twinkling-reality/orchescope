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
} from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import {
  definitionForCall,
  hasLocalBinding,
  matchRuntimeSymbol,
  moduleMatches,
} from '../matching.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';
import {
  clientTimeoutMs,
  type DeclaredDeadline,
  deadlineOfRelation,
  deadlineOnRelation,
  modelCallDeadline,
} from '../model-deadline.ts';
import { resolveSourceValue, type ResolvedSourceValue } from '../source-value.ts';

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
const LANGCHAIN_OPENAI_PACKAGES = ['langchain_openai'] as const;
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

type Discovered = { components: number; edges: number; files: Set<string> };

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
  const bases = resolved.definition.initializer ?? [];
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
          enclosing: resolved.definition?.name,
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
    { path: call.calleePath, origin: call.origin, enclosing: call.enclosing },
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
  return [
    ...new Map(
      rows.map((row) => [
        `${row.location.file}:${row.location.startLine}:${row.module}:${row.imported}`,
        row,
      ]),
    ).values(),
  ];
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
            { path: call.calleePath, origin: call.origin, enclosing: call.enclosing },
            {
              names: provider.clients,
              packages: provider.packages,
              defaultExportNames: defaultClientExports(call.origin?.module ?? ''),
            },
          ) !== undefined,
      );
      const root = supported ? call.calleePath[0] : undefined;
      const imported = root === undefined ? undefined : importForRoot(module, root);
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

const modelSdkApplicability = (context: DiscoveryContext): AdapterApplicability => {
  const rows = [...rawProviderImports(context), ...directWrapperImports(context)];
  return [
    ...new Map(
      rows.map((row) => [
        `${row.location.file}:${row.location.startLine}:${row.module}:${row.imported}`,
        row,
      ]),
    ).values(),
  ];
};

/** The variable a construction was assigned to, which is the name every later call reaches it by. */
const stableVariableHolding = (
  module: ModuleFacts,
  call: CallFact,
): { readonly name: string; readonly enclosing: string | undefined } | undefined => {
  const definition = definitionForCall(module, call);
  if (definition?.kind !== 'variable') return undefined;
  const definitions = module.definitions.filter(
    (candidate) =>
      candidate.kind === 'variable' &&
      candidate.name === definition.name &&
      candidate.enclosing === definition.enclosing,
  );
  if (definitions.length !== 1) return undefined;
  if (
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === definition.name &&
        assignment.enclosing === definition.enclosing,
    )
  ) {
    return undefined;
  }
  return { name: definition.name, enclosing: definition.enclosing };
};

const receiverKey = (enclosing: string | undefined, receiver: string): string =>
  `${enclosing ?? '<module>'}:${receiver}`;

type ProviderClient = {
  readonly provider: (typeof PROVIDERS)[number];
  readonly deadline: number | undefined;
  readonly supportingLocations: readonly SourceLocation[];
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
    { path: call.calleePath, origin: call.origin, enclosing: call.enclosing },
    {
      names: provider.clients,
      packages: provider.packages,
      defaultExportNames: defaultClientExports(call.origin?.module ?? ''),
    },
  );
  if (matched === undefined) return undefined;
  const entries = objectArgument(call);
  const timeout = clientTimeoutMs(call, module.language);
  const baseUrlFromConfig =
    stringValue(findEntry(entries, 'baseURL')?.value) ??
    stringValue(findEntry(entries, 'base_url')?.value);
  const metadata = {
    client: dotted(call.calleePath),
    ...(baseUrlFromConfig === undefined ? {} : { baseUrl: baseUrlFromConfig }),
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
  };
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
  const root = call.calleePath[0];
  const imported = root === undefined ? undefined : importForRoot(module, root);
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
  found.components += 1;
  found.files.add(module.file);
  const definition = stableVariableHolding(module, call);
  if (definition === undefined) return undefined;
  context.bindings.register(module.file, definition.name, providerIdentity(provider.provider));
  return {
    key: receiverKey(definition.enclosing, definition.name),
    client: {
      provider,
      deadline: timeout,
      supportingLocations: [...(imported === undefined ? [] : [imported.location]), call.location],
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
): ReadonlyMap<string, ProviderClient> => {
  const clients = new Map<string, ProviderClient>();
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
      if (registered !== undefined) clients.set(registered.key, registered.client);
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
  readonly method: string;
  readonly model: string;
  readonly deadline: DeclaredDeadline | undefined;
  readonly supportingLocations: readonly SourceLocation[];
};

const modelCallsIn = (
  module: ModuleFacts,
  clients: ReadonlyMap<string, ProviderClient>,
): readonly ModelCall[] => {
  const calls: ModelCall[] = [];
  for (const call of module.calls) {
    for (const provider of PROVIDERS) {
      const method = matchesMethod(call, provider.methods);
      if (method === undefined) continue;
      const receiver = clientReceiver(call, method);
      const scoped = clients.get(receiverKey(call.enclosing, receiver));
      const client =
        scoped ??
        (hasLocalBinding(module, call.enclosing, receiver)
          ? undefined
          : clients.get(receiverKey(undefined, receiver)));
      if (client?.provider !== provider) continue;
      calls.push({
        call,
        provider,
        method,
        model: stringValue(findEntry(objectArgument(call), 'model')?.value) ?? 'unspecified',
        deadline: modelCallDeadline(call, module.language, client.deadline),
        supportingLocations: client.supportingLocations,
      });
    }
  }
  return calls;
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

const registerModelCalls = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  context: DiscoveryContext,
  found: Discovered,
  clients: ReadonlyMap<string, ProviderClient>,
): void => {
  const modelCalls = modelCallsIn(module, clients);
  const declared = relationDeadlines(modelCalls);
  for (const { call, provider, method, model, supportingLocations } of modelCalls) {
    const entries = objectArgument(call);
    const maxTokens =
      numberValue(findEntry(entries, 'max_tokens')?.value) ??
      numberValue(findEntry(entries, 'maxTokens')?.value) ??
      numberValue(findEntry(entries, 'max_output_tokens')?.value);
    const temperature = numberValue(findEntry(entries, 'temperature')?.value);
    const streaming = method.includes('stream') || findEntry(entries, 'stream') !== undefined;

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
    found.components += 1;
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
    found.edges += 1;

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
      found.components += 1;
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
      found.edges += 1;
    }
  }
};

const stringResolution = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact | undefined,
): ResolvedSourceValue | undefined => {
  if (value === undefined) return undefined;
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
    modelResolution.basis === 'configuration_default' && providerDefaultValue === wrapper.provider;
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
  found.components += 2;
  found.edges += 1;
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
  version: '2',
  packages: ALL_PACKAGES,
  applicability: modelSdkApplicability,
  appliesTo: (context) => modelSdkApplicability(context).length > 0,
  discover: (context, builder): AdapterFindings => {
    const found: Discovered = { components: 0, edges: 0, files: new Set() };
    for (const module of context.modules) {
      const clientDeadlines = registerProviderClients(module, builder, context, found);
      registerModelCalls(module, builder, context, found, clientDeadlines);
      registerLangChainWrappers(module, builder, context, found);
    }
    return {
      componentsFound: found.components,
      edgesFound: found.edges,
      filesInspected: [...found.files],
    };
  },
};
