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

/**
 * The name a run will report for an agent, where this build knows one.
 *
 * `runtimeName` is a declaration that a running system will report a component under this name, and
 * reconciliation trusts it above everything except a code location: `byRuntimeName` is consulted before
 * kind and name. So a value that is not a name any run can report does not merely fail to match, it sits in
 * the strongest lookup in the reconciler waiting to match something else.
 *
 * CrewAI reports an agent by its role. This adapter named every agent it found, by the role where one is a
 * literal and otherwise by the variable, the method or the constant `agent`, and then declared that name as
 * the runtime name whatever it was. Three agents of the pinned marketing crew therefore declared that a run
 * would call them `lead_market_analyst`, `chief_marketing_strategist` and `creative_content_creator`, which
 * are the methods that build them and are names CrewAI never emits.
 *
 * A role read out of `agents.yaml` is the same fact from the other side, and it is the value to declare
 * there rather than the key the document happens to file it under. Folded YAML keeps the newline that ends
 * a `role: >` block, so the value is trimmed before it is used as a claim about what a run will say.
 *
 * Where no role is known this returns nothing at all. An absent runtime name says this build does not know
 * what the run will call the component, which is true, and leaves the join to the rules that match on what
 * was actually read.
 */
const runtimeNameOf = (role: string | undefined): { readonly runtimeName?: string } => {
  const trimmed = role?.trim();
  return trimmed === undefined || trimmed.length === 0 ? {} : { runtimeName: trimmed };
};

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
        /*
         * A crew document lists its members by the name of the file each one is declared in, and the role
         * that file carries is not read here, so nothing on this path knows what a run will call them.
         */
        metadata: { framework: 'crewai' },
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
          ...runtimeNameOf(role),
          ...(role === undefined ? {} : { declaredRole: role.trim() }),
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

/**
 * The name an `Agent(...)` call gives the agent it builds.
 *
 * A role written as a literal is the agent's own name and is what a run reports, so it wins. Where the
 * role is not a literal the call is inside something that names it, and which something depends on how
 * the crew is written. The framework's older documentation assigns the agent to a variable, which is the
 * definition the call sits in. The layout `crewai create crew` generates returns it from a decorated
 * method of a `@CrewBase` class, and `definitionForCall` answers with nothing there, because it looks for
 * a variable or a function and a method is neither.
 *
 * The fallback was therefore a constant. Every agent in one file became one component named `agent`: on
 * the pinned examples repository, forty four `Agent` calls across nineteen files became nineteen
 * components, each carrying every call site in its file. The marketing crew's three agents were one
 * component, and the two a reader could not see were not reported as unread either.
 *
 * `enclosing` is the nearest named function, class or method a call sits inside, and the fact model
 * already carries it, so the method that returns the agent names it without a parser learning anything
 * new. It is read after the definition rather than instead of it, because where both exist they are the
 * same name and the definition carries the location the rest of this adapter binds against.
 *
 * **This does not make such an agent join a run**, and the corpus records that it does not. CrewAI names
 * an agent by its role at run time, the role of an agent written this way is in the `agents.yaml` the
 * crew names, and the subscript that selects an entry of it is not a fact this model carries.
 */
const agentNameFor = (
  role: string | undefined,
  definitionName: string | undefined,
  enclosing: string | undefined,
): string => role ?? definitionName ?? enclosing ?? 'agent';

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
    const name = agentNameFor(role, definition?.name, match.call.enclosing);
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
        metadata: { framework: 'crewai', ...runtimeNameOf(role) },
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
