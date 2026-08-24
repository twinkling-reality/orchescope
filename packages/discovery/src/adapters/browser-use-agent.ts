import { CONFIDENCE_BANDS, identityKey } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry, numberValue } from '@orchescope/source-analysis';
import type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { hasBindingAt, matchCalls } from '../matching.ts';
import { promptCallSupport, registerPromptEntries } from '../prompt-input.ts';
import {
  BROWSER_USE_AGENT_ADAPTER_ID,
  BROWSER_USE_AGENT_EXPORT,
  BROWSER_USE_MODULE,
  BROWSER_USE_PACKAGES,
  browserUseAgentApplicability,
  browserUseAgentImports,
} from './browser-use-agent-origin.ts';

const drafts = createDrafts(BROWSER_USE_AGENT_ADAPTER_ID);
const REFUSAL_LIMIT = 10;

type TopologyAccumulator = {
  status: 'complete' | 'incomplete';
  inspectedInputs: number;
  explicitRelations: number;
  entryBoundaries: number;
  entryTargets: ComponentIdentity[];
  boundaryFacts: TopologyDiscovery['boundaryFacts'][number][];
  configurationBounds: number;
  configurationBoundFacts: TopologyDiscovery['configurationBoundFacts'][number][];
  unresolvedCount: number;
  unresolved: TopologyDiscovery['unresolved'][number][];
};

type Construction = {
  readonly identity: ComponentIdentity;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly sourceModule: ModuleFacts;
  readonly sourceCall: CallFact;
  readonly name: string;
  readonly bindingNames: readonly string[];
  readonly binding: DefinitionFact;
};

type FactoryTemplate = {
  readonly marker: ComponentIdentity;
  readonly module: ModuleFacts;
  readonly call: CallFact;
};

const topologyAccumulator = (inspectedInputs: number): TopologyAccumulator => ({
  status: 'incomplete',
  inspectedInputs,
  explicitRelations: 0,
  entryBoundaries: 0,
  entryTargets: [],
  boundaryFacts: [],
  configurationBounds: 0,
  configurationBoundFacts: [],
  unresolvedCount: 0,
  unresolved: [],
});

const refuse = (
  topology: TopologyAccumulator,
  entry: TopologyDiscovery['unresolved'][number],
): void => {
  topology.unresolvedCount += 1;
  if (topology.unresolved.length < REFUSAL_LIMIT) topology.unresolved.push(entry);
};

const topologyDiscovery = (topology: TopologyAccumulator): TopologyDiscovery => ({
  ...topology,
  conditionalConstructs: 0,
  conditionalDestinations: 0,
  terminalBoundaries: 0,
});

const keywordEntries = (call: CallFact): readonly ObjectEntryFact[] => {
  for (let index = call.args.length - 1; index >= 0; index -= 1) {
    const argument = call.args[index];
    if (argument?.kind === 'object') return argument.entries;
  }
  return [];
};

const contains = (container: SourceLocation, contained: SourceLocation): boolean => {
  const startsBefore =
    container.startLine < contained.startLine ||
    (container.startLine === contained.startLine &&
      (container.startColumn ?? 0) <= (contained.startColumn ?? 0));
  const containerEndLine = container.endLine ?? container.startLine;
  const containedEndLine = contained.endLine ?? contained.startLine;
  const endsAfter =
    containerEndLine > containedEndLine ||
    (containerEndLine === containedEndLine &&
      (container.endColumn ?? Number.MAX_SAFE_INTEGER) >= (contained.endColumn ?? 0));
  return startsBefore && endsAfter;
};

const endsBefore = (left: SourceLocation, right: SourceLocation): boolean => {
  const leftLine = left.endLine ?? left.startLine;
  const rightLine = right.startLine;
  if (leftLine !== rightLine) return leftLine < rightLine;
  return (left.endColumn ?? left.startColumn ?? 0) <= (right.startColumn ?? 0);
};

const samePath = (left: readonly string[] | undefined, right: readonly string[]): boolean =>
  left !== undefined &&
  left.length === right.length &&
  left.every((part, index) => part === right[index]);

const leafName = (name: string): string => name.split('.').at(-1) ?? name;

const argumentMentions = (value: ArgumentFact, name: string): boolean => {
  if (value.kind === 'identifier') return value.name === name;
  if (value.kind === 'member') return value.path[0] === name;
  if (value.kind === 'array') return value.items.some((item) => argumentMentions(item, name));
  if (value.kind === 'call') return value.args.some((item) => argumentMentions(item, name));
  if (value.kind === 'selection') {
    return value.alternatives.some((choice) => argumentMentions(choice.value, name));
  }
  if (value.kind !== 'object') return false;
  return (
    value.entries.some((entry) => argumentMentions(entry.value, name)) ||
    value.spreads?.some((spread) => argumentMentions(spread.value, name)) === true
  );
};

const isBrowserUseAgentCall = (call: CallFact): boolean =>
  call.origin?.module === BROWSER_USE_MODULE &&
  (call.origin.imported === BROWSER_USE_AGENT_EXPORT ||
    (call.origin.imported === '*' && call.calleePath.at(-1) === BROWSER_USE_AGENT_EXPORT));

const stableVariable = (module: ModuleFacts, call: CallFact): DefinitionFact | undefined => {
  const candidates = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      samePath(definition.initializer, call.calleePath) &&
      contains(definition.location, call.location) &&
      !module.calls.some(
        (other) =>
          other !== call &&
          contains(definition.location, other.location) &&
          contains(other.location, call.location),
      ),
  );
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (candidate === undefined) return undefined;
  const duplicate = module.definitions.some(
    (definition) =>
      definition !== candidate &&
      definition.kind === 'variable' &&
      definition.name === candidate.name &&
      definition.enclosing === candidate.enclosing &&
      module.calls.some(
        (other) =>
          other !== call &&
          (isBrowserUseAgentCall(other) || samePath(other.calleePath, call.calleePath)) &&
          contains(definition.location, other.location),
      ),
  );
  return duplicate ? undefined : candidate;
};

const factoryDefinition = (
  module: ModuleFacts,
  call: CallFact,
  accepted: readonly CallFact[],
): DefinitionFact | undefined => {
  if (call.enclosing === undefined) return undefined;
  const candidates = module.definitions.filter(
    (definition) =>
      definition.kind === 'function' &&
      definition.name === call.enclosing &&
      contains(definition.location, call.location) &&
      definition.returns?.length === 1 &&
      definition.returns[0]?.predicate === undefined &&
      definition.returns[0]?.value.kind === 'call' &&
      samePath(definition.returns[0].value.path, call.calleePath) &&
      contains(definition.returns[0].location, call.location),
  );
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (candidate === undefined) return undefined;
  const factoryName = leafName(candidate.name);
  if (
    candidate.async ||
    candidate.generator === true ||
    candidate.decorators.length > 0 ||
    module.assignments.some(
      (assignment) =>
        assignment.target[0] === factoryName && assignment.enclosing === candidate.enclosing,
    ) ||
    module.definitions.some(
      (definition) =>
        definition !== candidate &&
        leafName(definition.name) === factoryName &&
        definition.enclosing === candidate.enclosing,
    )
  ) {
    return undefined;
  }
  const callsInside = accepted.filter((entry) => contains(candidate.location, entry.location));
  return callsInside.length === 1 ? candidate : undefined;
};

const qualifiedVariableName = (definition: DefinitionFact): string =>
  definition.enclosing === undefined
    ? definition.name
    : `${definition.enclosing}.${definition.name}`;

const addAgentEvidence = (input: {
  readonly builder: SystemGraphBuilder;
  readonly identity: ComponentIdentity;
  readonly file: string;
  readonly name: string;
  readonly location: SourceLocation;
  readonly symbol: string;
}): void => {
  input.builder.addComponent(
    drafts.sourceComponent({
      kind: 'agent',
      identity: input.identity,
      file: input.file,
      name: input.name,
      location: input.location,
      symbol: input.symbol,
      confidence: CONFIDENCE_BANDS.deterministic,
      details: { for: 'agent', framework: 'browser-use', role: 'unspecified' },
      metadata: { framework: 'browser-use', sourceBinding: input.name },
      tags: ['browser-use'],
    }),
  );
};

const addConstruction = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly topology: TopologyAccumulator;
  readonly sourceModule: ModuleFacts;
  readonly sourceCall: CallFact;
  readonly bindingModule: ModuleFacts;
  readonly bindingCall: CallFact;
  readonly binding: DefinitionFact;
}): Construction => {
  const name = qualifiedVariableName(input.binding);
  const bindingNames = [input.binding.name];
  const identity = sourceIdentity('agent', input.bindingModule.file, name);
  addAgentEvidence({
    builder: input.builder,
    identity,
    file: input.sourceModule.file,
    name,
    location: input.sourceCall.location,
    symbol: 'browser_use.Agent',
  });
  for (const location of promptCallSupport(input.sourceModule, input.sourceCall).slice(0, -1)) {
    addAgentEvidence({
      builder: input.builder,
      identity,
      file: input.sourceModule.file,
      name,
      location,
      symbol: 'browser_use.Agent import',
    });
  }
  if (input.bindingCall !== input.sourceCall) {
    addAgentEvidence({
      builder: input.builder,
      identity,
      file: input.bindingModule.file,
      name,
      location: input.bindingCall.location,
      symbol: `${input.bindingCall.calleePath.join('.')} result`,
    });
  }
  for (const binding of bindingNames) {
    input.context.bindings.register(input.bindingModule.file, binding, identity);
  }
  const entries = keywordEntries(input.sourceCall);
  registerPromptEntries({
    registry: input.context.promptInputs,
    producer: BROWSER_USE_AGENT_ADAPTER_ID,
    module: input.sourceModule,
    call: input.sourceCall,
    consumer: identity,
    entries,
    channels: ['task'],
    supportingLocations: promptCallSupport(input.sourceModule, input.sourceCall),
  });
  const llm = findEntry(entries, 'llm');
  refuse(input.topology, {
    kind: 'adapter_input',
    reason:
      'The browser-use Agent llm input was not linked to an exact supported model identity, so no model or provider relation was added.',
    location: llm?.location ?? input.sourceCall.location,
  });
  refuse(input.topology, {
    kind: 'explicit_relation',
    reason:
      'Browser-use selects browser actions at runtime, so source does not establish a closed internal control-flow topology.',
    location: input.sourceCall.location,
  });
  return {
    identity,
    module: input.bindingModule,
    call: input.bindingCall,
    sourceModule: input.sourceModule,
    sourceCall: input.sourceCall,
    name,
    bindingNames,
    binding: input.binding,
  };
};

const factoryConstructions = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly topology: TopologyAccumulator;
  readonly templates: readonly FactoryTemplate[];
  readonly files: Set<string>;
}): Construction[] => {
  const templates = new Map(input.templates.map((entry) => [identityKey(entry.marker), entry]));
  const produced = new Set<string>();
  const constructions: Construction[] = [];
  for (const module of input.context.modules) {
    for (const call of module.calls) {
      if (call.calleePath.length !== 1) continue;
      const callee = call.calleePath[0];
      if (callee === undefined) continue;
      const resolved = input.context.bindings.lookup(module.file, callee);
      const template = resolved === undefined ? undefined : templates.get(identityKey(resolved));
      if (template === undefined) continue;
      input.files.add(module.file);
      if (call.awaited || hasBindingAt(module, call.enclosing, callee, call.location)) {
        refuse(input.topology, {
          kind: 'adapter_input',
          reason:
            'A browser-use Agent factory call was awaited or shadowed by a local binding, so no factory result identity was borrowed.',
          location: call.location,
        });
        continue;
      }
      const variable = stableVariable(module, call);
      if (variable === undefined) {
        refuse(input.topology, {
          kind: 'adapter_input',
          reason:
            'A local browser-use Agent factory result had no unique stable assigned call site, so no agent identity was invented.',
          location: call.location,
        });
        continue;
      }
      constructions.push(
        addConstruction({
          context: input.context,
          builder: input.builder,
          topology: input.topology,
          sourceModule: template.module,
          sourceCall: template.call,
          bindingModule: module,
          bindingCall: call,
          binding: variable,
        }),
      );
      produced.add(identityKey(template.marker));
    }
  }
  for (const template of input.templates) {
    if (produced.has(identityKey(template.marker))) continue;
    refuse(input.topology, {
      kind: 'adapter_input',
      reason:
        'A browser_use.Agent returned by a local factory had no unique stable assigned call site, so no agent identity was invented.',
      location: template.call.location,
    });
  }
  return constructions;
};

type ReceiverSettlement = {
  readonly definition: DefinitionFact | undefined;
  readonly unsettledAt: SourceLocation | undefined;
  readonly cause: 'changed' | 'unsettled' | undefined;
};

const interveningCall = (
  module: ModuleFacts,
  binding: DefinitionFact,
  run: CallFact,
): SourceLocation | undefined => {
  return module.calls.find((candidate) => {
    if (
      candidate === run ||
      candidate.enclosing !== run.enclosing ||
      !endsBefore(binding.location, candidate.location) ||
      !endsBefore(candidate.location, run.location)
    ) {
      return false;
    }
    return true;
  })?.location;
};

const stableReceiver = (
  module: ModuleFacts,
  call: CallFact,
  receiver: string,
): ReceiverSettlement => {
  const definitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === receiver &&
      definition.enclosing === call.enclosing &&
      endsBefore(definition.location, call.location),
  );
  if (definitions.length === 0) {
    return { definition: undefined, unsettledAt: undefined, cause: 'unsettled' };
  }
  const definition = definitions
    .toSorted((left, right) => (endsBefore(left.location, right.location) ? -1 : 1))
    .at(-1);
  if (definition === undefined) {
    return { definition: undefined, unsettledAt: undefined, cause: 'unsettled' };
  }
  if ((definition.branches?.length ?? 0) > 0) {
    return { definition: undefined, unsettledAt: definition.location, cause: 'unsettled' };
  }
  const reassigned = module.assignments.find(
    (assignment) =>
      assignment.enclosing === call.enclosing &&
      endsBefore(definition.location, assignment.location) &&
      endsBefore(assignment.location, call.location) &&
      (assignment.target[0] === receiver ||
        argumentMentions(assignment.value, receiver) ||
        assignment.sourceReferences?.some((path) => path[0] === receiver) === true),
  );
  if (reassigned !== undefined) {
    return { definition: undefined, unsettledAt: reassigned.location, cause: 'changed' };
  }
  const escapedDefinition = module.definitions.find(
    (other) =>
      other !== definition &&
      other.enclosing === call.enclosing &&
      endsBefore(definition.location, other.location) &&
      endsBefore(other.location, call.location) &&
      other.value !== undefined &&
      argumentMentions(other.value, receiver),
  );
  if (escapedDefinition !== undefined) {
    return { definition: undefined, unsettledAt: escapedDefinition.location, cause: 'changed' };
  }
  const interveningAt = interveningCall(module, definition, call);
  if (interveningAt !== undefined) {
    return { definition: undefined, unsettledAt: interveningAt, cause: 'unsettled' };
  }
  const escaped = module.calls.find(
    (other) =>
      other !== call &&
      other.enclosing === call.enclosing &&
      endsBefore(definition.location, other.location) &&
      endsBefore(other.location, call.location) &&
      (other.calleePath[0] === receiver ||
        other.args.some((argument) => argumentMentions(argument, receiver))),
  );
  return escaped === undefined
    ? {
        definition,
        unsettledAt: definitions.length > 1 ? definition.location : undefined,
        cause: definitions.length > 1 ? 'changed' : undefined,
      }
    : { definition: undefined, unsettledAt: escaped.location, cause: 'unsettled' };
};

const bindingKey = (module: ModuleFacts, definition: DefinitionFact): string =>
  `${module.file}:${definition.location.startLine}:${definition.location.startColumn ?? 0}:${definition.location.endLine ?? definition.location.startLine}:${definition.location.endColumn ?? 0}`;

const runRefusalReason = (cause: ReceiverSettlement['cause']): string =>
  cause === 'changed'
    ? 'A browser-use run receiver was rebound, mutated or escaped before this call, so the run boundary was not attached to an agent identity.'
    : 'Source did not prove that a browser-use run receiver remained stable through an intervening operation, so the run boundary was not attached to an agent identity.';

const addRunBoundaries = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly topology: TopologyAccumulator;
  readonly constructions: readonly Construction[];
  readonly files: Set<string>;
}): { readonly reached: Set<string>; readonly attempted: Set<string> } => {
  const constructionsByBinding = new Map(
    input.constructions.map((entry) => [bindingKey(entry.module, entry.binding), entry] as const),
  );
  const identities = new Set(input.constructions.map((entry) => identityKey(entry.identity)));
  const reached = new Set<string>();
  const attempted = new Set<string>();
  for (const module of input.context.modules) {
    for (const call of module.calls) {
      if (call.calleePath.length !== 2 || call.calleePath[1] !== 'run') continue;
      const receiver = call.calleePath[0];
      if (receiver === undefined) continue;
      const settlement = stableReceiver(module, call, receiver);
      const construction =
        settlement.definition === undefined
          ? undefined
          : constructionsByBinding.get(bindingKey(module, settlement.definition));
      if (construction === undefined) {
        const resolved = input.context.bindings.lookup(module.file, receiver);
        if (resolved === undefined || !identities.has(identityKey(resolved))) continue;
        attempted.add(identityKey(resolved));
        refuse(input.topology, {
          kind: 'entry_boundary',
          reason: runRefusalReason(settlement.cause),
          location: settlement.unsettledAt ?? call.location,
        });
        continue;
      }
      input.files.add(module.file);
      attempted.add(identityKey(construction.identity));
      reached.add(identityKey(construction.identity));
      input.topology.entryBoundaries += 1;
      input.topology.entryTargets.push(construction.identity);
      input.topology.boundaryFacts.push({ kind: 'entry', location: call.location });
      addAgentEvidence({
        builder: input.builder,
        identity: construction.identity,
        file: module.file,
        name: construction.name,
        location: call.location,
        symbol: `${receiver}.run`,
      });
      const maxSteps = findEntry(keywordEntries(call), 'max_steps');
      const literal = numberValue(maxSteps?.value);
      if (literal === undefined || !Number.isInteger(literal) || literal <= 0) {
        refuse(input.topology, {
          kind: 'config_backed_bound',
          reason:
            'browser-use max_steps is absent or runtime-configurable, so no universal execution bound was claimed.',
          location: maxSteps?.location ?? call.location,
        });
      }
    }
  }
  return { reached, attempted };
};

export const browserUseAgentAdapter: AgentSystemAdapter = {
  id: BROWSER_USE_AGENT_ADAPTER_ID,
  version: '1',
  packages: BROWSER_USE_PACKAGES,
  applicability: browserUseAgentApplicability,
  appliesTo: (context) => browserUseAgentApplicability(context).length > 0,
  discover: (context, builder): AdapterFindings => {
    const applicability = browserUseAgentApplicability(context);
    const acceptedMatches = matchCalls(context.modules, {
      names: [BROWSER_USE_AGENT_EXPORT],
      packages: [BROWSER_USE_MODULE],
      kind: 'call',
    });
    const topology = topologyAccumulator(acceptedMatches.length);
    const files = new Set(applicability.map((entry) => entry.location.file));
    const constructions: Construction[] = [];
    const templates: FactoryTemplate[] = [];
    const byModule = new Map<ModuleFacts, CallFact[]>();
    for (const match of acceptedMatches) {
      const calls = byModule.get(match.module) ?? [];
      calls.push(match.call);
      byModule.set(match.module, calls);
    }
    for (const match of acceptedMatches) {
      files.add(match.module.file);
      const variable = stableVariable(match.module, match.call);
      if (variable !== undefined) {
        constructions.push(
          addConstruction({
            context,
            builder,
            topology,
            sourceModule: match.module,
            sourceCall: match.call,
            bindingModule: match.module,
            bindingCall: match.call,
            binding: variable,
          }),
        );
        continue;
      }
      const factory = factoryDefinition(match.module, match.call, byModule.get(match.module) ?? []);
      if (factory !== undefined) {
        const marker = sourceIdentity('agent', match.module.file, factory.name);
        const leaf = leafName(factory.name);
        context.bindings.register(match.module.file, factory.name, marker);
        context.bindings.register(match.module.file, leaf, marker);
        templates.push({ marker, module: match.module, call: match.call });
        continue;
      }
      refuse(topology, {
        kind: 'adapter_input',
        reason:
          'A browser_use.Agent construction had no unique direct binding or returned local factory, so no agent identity was invented.',
        location: match.call.location,
      });
    }
    if (acceptedMatches.length === 0) {
      const first = context.modules
        .flatMap((module) => browserUseAgentImports(context, module))
        .at(0);
      refuse(topology, {
        kind: 'adapter_input',
        reason:
          'browser_use.Agent was imported, but no exact unshadowed construction was source-settled.',
        ...(first === undefined ? {} : { location: first.location }),
      });
    }
    constructions.push(...factoryConstructions({ context, builder, topology, templates, files }));
    const runBoundaries = addRunBoundaries({
      context,
      builder,
      topology,
      constructions,
      files,
    });
    for (const construction of constructions) {
      if (runBoundaries.attempted.has(identityKey(construction.identity))) continue;
      refuse(topology, {
        kind: 'entry_boundary',
        reason: 'No exact browser-use Agent.run boundary was source-settled for this construction.',
        location: construction.call.location,
      });
    }
    const componentCount = new Set(constructions.map((entry) => identityKey(entry.identity))).size;
    return {
      componentsFound: componentCount,
      edgesFound: 0,
      filesInspected: [...files].sort(),
      note:
        componentCount === 0
          ? 'No exact browser-use Agent identity was established; bounded refusals describe the inspected input.'
          : `Browser-use agent identities were discovered; ${topology.entryBoundaries} exact Agent.run ${topology.entryBoundaries === 1 ? 'boundary was' : 'boundaries were'} source-settled, and runtime-selected browser control flow remains unresolved.`,
      topology: topologyDiscovery(topology),
    };
  },
};
