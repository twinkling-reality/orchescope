import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import {
  findEntry,
  identifierItems,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { asRecord, asString, asStringArray, jsonPointer } from '../config-files.ts';
import { configIdentity, createDrafts, sourceIdentity } from '../drafts.ts';
import { definitionForCall, matchCalls, projectUses } from '../matching.ts';

/**
 * CrewAI, from source and from its declarative files.
 *
 * CrewAI describes a crew as agents plus tasks plus a process, and recent versions moved that
 * description into declarative files. Reading `crew.jsonc` and `config/agents.yaml` is both cheaper and
 * higher fidelity than reading the source, so configuration wins when both are present and the source
 * pass fills in what configuration does not declare.
 */

const PACKAGES = ['crewai', 'crewai_tools', 'crewai-tools'];
const ADAPTER_ID = 'adapter:crewai';
const drafts = createDrafts(ADAPTER_ID);

type Counts = { components: number; edges: number };

/** A crew document declares the group and the agents it contains. */
const discoverCrewDocument = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  document: { readonly path: string },
  root: Record<string, unknown>,
): Counts => {
  const crewName = asString(root['name']) ?? 'crew';
  const crewIdentity = configIdentity('agent_group', document.path, crewName);
  builder.addComponent(
    drafts.configComponent({
      kind: 'agent_group',
      configFile: document.path,
      pointer: jsonPointer(['name']),
      name: crewName,
      value: asString(root['process']) ?? 'sequential',
      metadata: {
        framework: 'crewai',
        process: asString(root['process']) ?? 'sequential',
        runtimeName: crewName,
      },
      tags: ['crewai', 'declared'],
    }),
  );
  let components = 1;
  let edges = 0;

  for (const [index, agentName] of asStringArray(root['agents']).entries()) {
    const agentIdentity = configIdentity('agent', document.path, agentName);
    builder.addComponent(
      drafts.configComponent({
        kind: 'agent',
        configFile: document.path,
        pointer: jsonPointer(['agents', index]),
        name: agentName,
        details: { for: 'agent', framework: 'crewai', role: 'worker' },
        metadata: { framework: 'crewai', runtimeName: agentName },
        tags: ['crewai', 'declared'],
      }),
    );
    components += 1;
    builder.addEdge(
      drafts.edge({
        kind: 'contains',
        from: crewIdentity,
        to: agentIdentity,
        configFile: document.path,
        pointer: jsonPointer(['agents', index]),
      }),
    );
    edges += 1;
    context.bindings.register(document.path, agentName, agentIdentity);
  }
  return { components, edges };
};

/** An agents document declares one agent per key, each optionally naming the model it uses. */
const discoverAgentsDocument = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  document: { readonly path: string },
  root: Record<string, unknown>,
): Counts => {
  let components = 0;
  let edges = 0;

  for (const [agentName, rawAgent] of Object.entries(root)) {
    const agent = asRecord(rawAgent);
    if (agent === undefined) continue;
    const identity = configIdentity('agent', document.path, agentName);
    const role = asString(agent['role']);
    const goal = asString(agent['goal']);
    builder.addComponent(
      drafts.configComponent({
        kind: 'agent',
        configFile: document.path,
        pointer: jsonPointer([agentName]),
        name: agentName,
        ...(goal === undefined ? {} : { description: goal.slice(0, 240) }),
        details: { for: 'agent', framework: 'crewai', role: 'worker' },
        metadata: {
          framework: 'crewai',
          runtimeName: agentName,
          ...(role === undefined ? {} : { declaredRole: role }),
        },
        tags: ['crewai', 'declared'],
      }),
    );
    components += 1;
    context.bindings.register(document.path, agentName, identity);

    const llm = asString(agent['llm']);
    if (llm === undefined) continue;
    const modelIdentity = configIdentity('model', document.path, llm);
    builder.addComponent(
      drafts.configComponent({
        kind: 'model',
        configFile: document.path,
        pointer: jsonPointer([agentName, 'llm']),
        name: llm,
        details: { for: 'model', modelId: llm },
        metadata: { framework: 'crewai' },
        tags: ['crewai'],
      }),
    );
    components += 1;
    builder.addEdge(
      drafts.edge({
        kind: 'invokes_model',
        from: identity,
        to: modelIdentity,
        configFile: document.path,
        pointer: jsonPointer([agentName, 'llm']),
      }),
    );
    edges += 1;
  }
  return { components, edges };
};

const discoverFromConfig = (context: DiscoveryContext, builder: SystemGraphBuilder): Counts => {
  let components = 0;
  let edges = 0;

  for (const document of context.configs) {
    const root = asRecord(document.data);
    if (root === undefined) continue;
    const found =
      document.path === 'crew.jsonc'
        ? discoverCrewDocument(context, builder, document, root)
        : document.path.endsWith('agents.yaml')
          ? discoverAgentsDocument(context, builder, document, root)
          : { components: 0, edges: 0 };
    components += found.components;
    edges += found.edges;
  }
  return { components, edges };
};

type SourceCounts = { components: number; edges: number; files: Set<string> };

const discoverAgentCalls = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  files: Set<string>,
): number => {
  let components = 0;
  for (const match of matchCalls(context.modules, { names: ['Agent'], packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const role = stringValue(findEntry(entries, 'role')?.value);
    const name = role ?? definition?.name ?? 'agent';
    const goal = stringValue(findEntry(entries, 'goal')?.value);
    const identity = sourceIdentity('agent', match.module.file, name);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        file: match.module.file,
        name,
        location: match.call.location,
        symbol: definition?.name ?? 'Agent',
        confidence: match.confidence,
        ...(goal === undefined ? {} : { description: goal.slice(0, 240) }),
        details: { for: 'agent', framework: 'crewai', role: 'worker' },
        metadata: { framework: 'crewai', runtimeName: name },
        tags: ['crewai'],
      }),
    );
    components += 1;
    files.add(match.module.file);
    if (definition !== undefined) {
      context.bindings.register(match.module.file, definition.name, identity);
    }
    context.bindings.register(match.module.file, name, identity);
  }
  return components;
};

/** Crews are read after agents so that a member reference resolves to the agent it names. */
const discoverCrewCalls = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  files: Set<string>,
): Counts => {
  let components = 0;
  let edges = 0;
  for (const match of matchCalls(context.modules, { names: ['Crew'], packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const name = definition?.name ?? 'crew';
    const crewIdentity = sourceIdentity('agent_group', match.module.file, name);
    const process = stringValue(findEntry(entries, 'process')?.value);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent_group',
        file: match.module.file,
        name,
        location: match.call.location,
        symbol: 'Crew',
        confidence: match.confidence,
        metadata: { framework: 'crewai', ...(process === undefined ? {} : { process }) },
        tags: ['crewai'],
      }),
    );
    components += 1;
    files.add(match.module.file);

    for (const memberName of identifierItems(findEntry(entries, 'agents')?.value)) {
      const target = context.bindings.lookup(match.module.file, memberName);
      if (target === undefined) continue;
      builder.addEdge(
        drafts.edge({
          kind: 'contains',
          from: crewIdentity,
          to: target,
          location: match.call.location,
          symbol: `agents: ${memberName}`,
          confidence: CONFIDENCE_BANDS.strongStructural,
        }),
      );
      edges += 1;
    }
  }
  return { components, edges };
};

const discoverFromSource = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): SourceCounts => {
  const files = new Set<string>();
  const agents = discoverAgentCalls(context, builder, files);
  const crews = discoverCrewCalls(context, builder, files);
  return { components: agents + crews.components, edges: crews.edges, files };
};

export const crewAiAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  packages: PACKAGES,
  appliesTo: (context) =>
    projectUses(context, PACKAGES) ||
    context.configs.some(
      (document) => document.path === 'crew.jsonc' || document.path.endsWith('agents.yaml'),
    ),
  discover: (context, builder): AdapterFindings => {
    const fromConfig = discoverFromConfig(context, builder);
    const fromSource = discoverFromSource(context, builder);
    return {
      componentsFound: fromConfig.components + fromSource.components,
      edgesFound: fromConfig.edges + fromSource.edges,
      filesInspected: [...fromSource.files, ...context.configs.map((entry) => entry.path)],
    };
  },
};
