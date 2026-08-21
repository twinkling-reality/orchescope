import { CONFIDENCE_BANDS, formatCount, normalizeLocalName } from '@orchescope/domain';
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
 * description into declarative files. Both passes run and neither wins, because nothing in the
 * repository says which call builds which declared agent.
 *
 * `Agent(config=self.agents_config['lead_market_analyst'])` is the whole of the link, and the fact model
 * records that argument as an unknown subscript with no key in it: `analyze.ts` has no subscript case, and
 * the string `config/agents.yaml` the class attribute holds is a definition with a location and no value.
 * The obvious substitute is the method the call sits in, and it is measurably wrong: across the pinned
 * examples repository, 31 of the 50 `Agent` calls that sit beside an `agents.yaml` have an enclosing name
 * that is a key in it, and the other 19 would attach a call to the wrong declared agent. A method with an
 * `_agent` suffix the key lacks, a call in a class body naming the class, and a crew whose document
 * describes a different crew are each enough to break it.
 *
 * So a configured agent and the call that builds it are two components. The cost is visible: on one pinned
 * crew, four declared agents and three calls produce seven agent components where the repository has four
 * agents. The alternative is a guess that reads like a measurement, which is the failure this join exists
 * to avoid, and closing it means teaching a parser to carry a subscript key first.
 */

/**
 * The role a run will report, out of the role a document or a call declares.
 *
 * `runtimeName` is a declaration that a running system will report a component under this name, and
 * reconciliation trusts it above everything except a code location: `byRuntimeName` is consulted before
 * kind and name. So a value that is not a name any run can report does not merely fail to match, it sits in
 * the strongest lookup in the reconciler waiting to match something else.
 *
 * CrewAI reports an agent by its role, and two spellings of a role are not one. Folded YAML keeps the
 * newline that ends a `role: >` block, and every one of the 48 roles in the pinned examples repository is
 * written that way, so a raw value would match none of them. And CrewAI interpolates a role before it uses
 * it: the templates its own CLI writes declare `{topic} Senior Data Researcher`, which is two of the five
 * distinct roles in the pinned framework repository. A run reports whatever `{topic}` was, so the literal
 * string is a name no run can report and is declined here rather than filed as one.
 *
 * Where no role survives that, this returns nothing at all. An absent runtime name says this build does not
 * know what the run will call the component, which is true, and leaves the join to the rules that match on
 * what was actually read.
 *
 * **Naming a component and claiming a runtime name are separate decisions, and only the second is a claim
 * about a run.** A document holds two names for one agent, the key and the role, so when the role is a
 * template the key is a name the repository actually wrote and the component takes it. A call site holds
 * one, and replacing it with the variable the call is assigned to collapsed three distinctly declared
 * agents of the framework's own test suite into a single component named `agent`, which is the failure
 * 0.8.0 fixed. So a call keeps naming itself by the literal it carries, and declines only to promise that
 * a run will say it.
 */
const reportedRole = (role: string | undefined): string | undefined => {
  const trimmed = role?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return trimmed.includes('{') ? undefined : trimmed;
};

const runtimeNameOf = (reported: string | undefined): { readonly runtimeName?: string } =>
  reported === undefined ? {} : { runtimeName: reported };

/**
 * Whether a document named `agents.yaml` declares a crew's agents.
 *
 * The name belongs to no framework. This build finds `agents.yaml` wherever the bounded traversal walked,
 * and a repository is free to keep a monitoring inventory or a deployment roster under it. Applying the
 * adapter on the name alone is the failure already recorded for `.mcp.json` in `config-files.ts`, where
 * reading a developer's own tooling reported a 220 component Workers application as a detected agent system
 * with no agent in it. One record valued key is enough: two constructed repositories depending on express
 * and on axios, with a root `agents.yaml` holding hosts and ports, were both reported as detected agent
 * systems with the entries of that file as their agents.
 *
 * CrewAI's `Agent` takes a role, a goal and a backstory, and all 60 agent entries readable across the
 * examples repository, the framework's own templates and its tests declare all three as strings. The test
 * asks for the first two. A backstory is present in every field document and in neither entry of the two
 * agent fixture this repository writes, so requiring it would reject a document CrewAI accepts.
 */
const declaresAnAgent = (root: Record<string, unknown>): boolean =>
  Object.values(root).some((entry) => {
    const agent = asRecord(entry);
    if (agent === undefined) return false;
    return (
      (asString(agent['role']) ?? '').trim().length > 0 &&
      (asString(agent['goal']) ?? '').trim().length > 0
    );
  });

const AGENTS_DOCUMENT = 'agents.yaml';

const isAgentsDocumentPath = (path: string): boolean => path.split('/').at(-1) === AGENTS_DOCUMENT;

const isAgentsDocument = (path: string, root: Record<string, unknown>): boolean =>
  isAgentsDocumentPath(path) && declaresAnAgent(root);

const PACKAGES = ['crewai', 'crewai_tools', 'crewai-tools'];
const ADAPTER_ID = 'adapter:crewai';
const drafts = createDrafts(ADAPTER_ID);

type Counts = { components: number; edges: number };

/** A role declined as a name is counted so the decline can be stated rather than left as a silence. */
type AgentsDocumentCounts = Counts & { declinedRoles: number };

type ConfigCounts = AgentsDocumentCounts & { files: readonly string[] };

type AgentEntry = {
  readonly key: string;
  readonly agent: Record<string, unknown>;
  /** Verbatim, so `declaredRole` records what the document says even where it is not a name. */
  readonly role: string | undefined;
  readonly reported: string | undefined;
};

const agentEntriesOf = (root: Record<string, unknown>): readonly AgentEntry[] => {
  const entries: AgentEntry[] = [];
  for (const [key, rawAgent] of Object.entries(root)) {
    const agent = asRecord(rawAgent);
    if (agent === undefined) continue;
    const role = asString(agent['role']);
    entries.push({ key, agent, role, reported: reportedRole(role) });
  }
  return entries;
};

/**
 * The name each entry of one document takes.
 *
 * A key is unique inside a document; a role is not. Two entries may declare one role, and one entry's role
 * may be another entry's key. Naming by the role alone let those collapse into a single component, because
 * the builder merges on identity, and the survivor carried one entry's goal beside the other's runtime name
 * and the other's model. A role that names two entries of one document is not a name for either of them, so
 * both take their key. The role each declares is still recorded and still claimed as a runtime name, which
 * is what makes a run reporting it ambiguous rather than attributed to whichever entry was read first.
 */
const namesFor = (entries: readonly AgentEntry[]): ReadonlyMap<string, string> => {
  const claims = new Map<string, number>();
  for (const entry of entries) {
    const candidate = normalizeLocalName(entry.reported ?? entry.key);
    claims.set(candidate, (claims.get(candidate) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const entry of entries) {
    const candidate = entry.reported ?? entry.key;
    names.set(
      entry.key,
      (claims.get(normalizeLocalName(candidate)) ?? 0) > 1 ? entry.key : candidate,
    );
  }
  return names;
};

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

/**
 * An agents document declares one agent per key, each optionally naming the model it uses.
 *
 * **The role names the component and the key does not.** CrewAI reports an agent by its role at run time,
 * and naming a configured agent after the key its document files it under put every such declaration into
 * the reconciler under a name no run says. On the pinned examples repository that was not a missed join but
 * a wrong one: the marketing crew's three roles are declared in a document under `src/`, one other
 * application declares the same three roles as literals in Python, and a run of the marketing crew joined
 * all three of its agents to that other application. Under the role, each of those names has three
 * declarations, `uniqueCandidate` returns nothing, and the reconciler records an ambiguity instead. A
 * repository that declares one role in two applications gets a refusal, which is the true answer.
 *
 * The key is still what the document is indexed by and is still what a caller writes to select an entry, so
 * it stays as the pointer the evidence carries and as the name this document binds the component under, and
 * it is what names the component wherever the role cannot: where no role survives `reportedRole`, and where
 * one role names two entries.
 */
const discoverAgentsDocument = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  document: { readonly path: string },
  root: Record<string, unknown>,
): AgentsDocumentCounts => {
  let components = 0;
  let edges = 0;
  let declinedRoles = 0;
  const entries = agentEntriesOf(root);
  const naming = namesFor(entries);

  for (const entry of entries) {
    const { key: agentName, agent, role, reported } = entry;
    /*
     * Counted off the raw value rather than off `role`, which is the value only where it parsed as a string.
     * `role: {topic}` in flow style is a mapping, so it is declined by a second branch and would otherwise be
     * declined without being counted, which is the one case this count exists for.
     */
    if (agent['role'] !== undefined && reported === undefined) declinedRoles += 1;
    const name = naming.get(agentName) ?? agentName;
    const identity = configIdentity('agent', document.path, name);
    const goal = asString(agent['goal']);
    builder.addComponent(
      drafts.configComponent({
        kind: 'agent',
        configFile: document.path,
        pointer: jsonPointer([agentName]),
        name,
        ...(goal === undefined ? {} : { description: goal.slice(0, 240) }),
        details: { for: 'agent', framework: 'crewai', role: 'worker' },
        metadata: {
          framework: 'crewai',
          ...runtimeNameOf(reported),
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
  return { components, edges, declinedRoles };
};

/**
 * Only the documents this adapter read.
 *
 * `filesInspected` used to be every configuration document the scan parsed, which after `agents.yaml` became
 * a name found in the traversal would have had this adapter claim to have inspected every document it
 * declined as well as every one it read.
 */
const discoverFromConfig = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): ConfigCounts => {
  let components = 0;
  let edges = 0;
  let declinedRoles = 0;
  const files: string[] = [];

  for (const document of context.configs) {
    const root = asRecord(document.data);
    if (root === undefined) continue;
    if (document.path === 'crew.jsonc') {
      const found = discoverCrewDocument(context, builder, document, root);
      components += found.components;
      edges += found.edges;
      files.push(document.path);
      continue;
    }
    if (!isAgentsDocument(document.path, root)) continue;
    const found = discoverAgentsDocument(context, builder, document, root);
    components += found.components;
    edges += found.edges;
    declinedRoles += found.declinedRoles;
    files.push(document.path);
  }
  return { components, edges, declinedRoles, files };
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
 *
 * The role is taken here as it was written, template braces and all, which is not what `reportedRole`
 * hands to `runtimeName`. A literal is the only name a call site carries, and declining it sends fourteen
 * calls in one file to the variable they share.
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
        metadata: { framework: 'crewai', ...runtimeNameOf(reportedRole(role)) },
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
    context.configs.some((document) => {
      if (document.path === 'crew.jsonc') return true;
      const root = asRecord(document.data);
      return root !== undefined && isAgentsDocument(document.path, root);
    }),
  discover: (context, builder): AdapterFindings => {
    const fromConfig = discoverFromConfig(context, builder);
    const fromSource = discoverFromSource(context, builder);
    return {
      componentsFound: fromConfig.components + fromSource.components,
      edgesFound: fromConfig.edges + fromSource.edges,
      filesInspected: [...fromSource.files, ...fromConfig.files],
      ...(fromConfig.declinedRoles === 0
        ? {}
        : {
            note: `${formatCount(fromConfig.declinedRoles, 'declared role is', 'declared roles are')} not a name a run can report, a template such as {topic} Researcher or a value that is not a string, so the key in the document names the component and no runtime name is claimed`,
          }),
    };
  },
};
