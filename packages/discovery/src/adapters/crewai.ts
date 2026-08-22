import { CONFIDENCE_BANDS, formatCount, normalizeLocalName } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type {
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
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
 * CrewAI describes a crew as agents plus tasks plus a process, and recent versions moved that description
 * into declarative files. Both passes run and they meet where the repository says they do:
 * `Agent(config=self.agents_config['lead_market_analyst'])` names a document and an entry of it, and every
 * step of that is now a fact rather than a guess. The subscript carries its literal key, the class attribute
 * carries the literal path, and the path resolves beside the file that wrote it. Where the three hold, the
 * call and the entry are one agent and the call adds a source location to what the document declared.
 *
 * Where any of them does not hold, the call names itself and stays its own component. The substitute that
 * refusing avoids is the enclosing method name, measured on the pinned examples repository at 31 of 50
 * correct: a method with an `_agent` suffix the key lacks, a call in a class body naming the class, and a
 * crew whose document describes a different crew each break it, and none of the three can be told from a
 * match. `stock_analysis/crew.py` is the case that shows the cost, where `financial_agent` and
 * `financial_analyst_agent` both select `financial_analyst`: under the enclosing name one declared agent
 * became two components and nothing recorded that it had.
 *
 * **The join is between two declarations and it is not a join to a run.** Reading it moved
 * `crewai-examples` from 121 agent components to 81 and left `crewai-examples-exercised` reporting zero
 * exercised components against the same three ambiguous names, because a repository that declares one role
 * in three places still gets a refusal. A fact that records what the syntax says cannot make the two halves
 * of that join agree, and the corpus is where that is checked rather than argued.
 */

/**
 * The role a run will report, out of the role a document or a call declares.
 *
 * `runtimeName` is a declaration that a running system will report a component under this name, and
 * reconciliation trusts it above everything except a code location: `byRuntimeName` is consulted before
 * kind and name. So a value that is not a name any run can report does not merely fail to match, it sits in
 * the strongest lookup in the reconciler waiting to match something else.
 *
 * CrewAI reports an agent by its role. Folded YAML keeps the newline that ends a `role: >` block and every
 * one of the 48 roles in the pinned examples repository is written that way, so the value is trimmed here:
 * `normalizeLocalName` would trim it again on both sides of any comparison, but a component that carries a
 * newline inside its declared name puts it into every document a reader sees. And CrewAI interpolates a role
 * before it uses it: the templates its own CLI writes declare `{topic} Senior Data Researcher`, which is two
 * of the five distinct roles in the pinned framework repository. A run reports whatever `{topic}` was, so
 * the literal string is a name no run can report and is declined here rather than filed as one.
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
 * CrewAI's `Agent` takes a role, a goal and a backstory, and all 55 agent entries in the two pinned
 * checkouts, 48 across the examples repository and 7 across the framework's own templates and tests, declare
 * all three as strings. The test asks for the first two. A backstory is present in every one of those and in
 * neither entry of the two agent fixture this repository writes, so requiring it would reject a document
 * CrewAI accepts.
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

/**
 * An agents document is read only where the repository declares the framework whose layout puts one there.
 *
 * `agents.yaml` is found wherever the bounded traversal walked, and the shape below is a shape rather than a
 * framework: a roster whose entries carry a role and a goal passes it, and a repository depending on express
 * and nothing else was reported as a detected agent system with two CrewAI agents in it. The layout this
 * reading exists for cannot occur without the dependency, because `Agent(config=self.agents_config[...])`
 * imports `crewai` to run at all, so requiring it costs nothing measurable and closes the whole widening.
 *
 * The two paths this build opens without waiting for the traversal, the root `agents.yaml` and
 * `config/agents.yaml`, were exempt from that gate on the reasoning that they were read first and gating
 * them would be a second change. They were not exempt from the widening: the same express repository with
 * the same roster at the root rather than under `deploy/` declared its account executives as agents and was
 * reported as an agent system. Where a document sits decides how it was found and decides nothing about who
 * may read it, so the gate is asked of every agents document and the origin no longer comes into it.
 */
const isAgentsDocument = (
  path: string,
  root: Record<string, unknown>,
  declaresTheFramework: boolean,
): boolean => isAgentsDocumentPath(path) && declaresTheFramework && declaresAnAgent(root);

const PACKAGES = ['crewai', 'crewai_tools', 'crewai-tools'];
const ADAPTER_ID = 'adapter:crewai';
const drafts = createDrafts(ADAPTER_ID);

type Counts = { components: number; edges: number };

/**
 * A role declined as a name is counted so the decline can be stated rather than left as a silence.
 *
 * The count spans both passes: a role is declined the same way whether it was written in a document or in a
 * call, and counting only the documents told a reader that one of two declined templates had been declined.
 */
type AgentsDocumentCounts = Counts & { declinedRoles: number };

type ConfigCounts = AgentsDocumentCounts & {
  files: readonly string[];
  /** What each document named each of its keys, which is what a call selecting a key has to resolve to. */
  documents: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

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
 * and the other's model. Worse than losing a declaration, it made the merged one unique: `uniqueCandidate`
 * dedupes by component id, so a run reporting that role joined it by `runtime_name` and nothing recorded
 * that two declarations had gone in.
 *
 * A role that names two entries of one document is not a name for either of them, so both take their key.
 * Each still declares the role, so a run reporting it now matches two components, is joined to neither, and
 * is reported as exercised and never declared. Measured: no match, and `joins.ambiguous` does not name it
 * either, because the reconciler records an ambiguity only where kind and name found more than one and a tie
 * in the runtime name lookup alone falls through.
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
): AgentsDocumentCounts & { naming: ReadonlyMap<string, string> } => {
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
  return { components, edges, declinedRoles, naming };
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
  const documents = new Map<string, ReadonlyMap<string, string>>();
  const declaresTheFramework = projectUses(context, PACKAGES);

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
    if (!isAgentsDocument(document.path, root, declaresTheFramework)) continue;
    const found = discoverAgentsDocument(context, builder, document, root);
    components += found.components;
    edges += found.edges;
    declinedRoles += found.declinedRoles;
    files.push(document.path);
    documents.set(document.path, found.naming);
  }
  return { components, edges, declinedRoles, files, documents };
};

type SourceCounts = {
  components: number;
  edges: number;
  declinedRoles: number;
  files: Set<string>;
};

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
 * This is reached only where `configuredEntry` found nothing, so it names a call that selects no declared
 * entry rather than one whose entry this build failed to follow. It remains a name and not a claim about a
 * run: CrewAI reports an agent by its role, and a method name is not one.
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

/** Each agents document this adapter read, by path, with the name it gave each of its keys. */
type AgentsDocuments = ReadonlyMap<string, ReadonlyMap<string, string>>;

/**
 * A path written beside the file that writes it, resolved against that file's directory.
 *
 * Kept to string manipulation because nothing here touches a filesystem: the answer is only ever compared
 * against the paths of documents the scan already read, and a path that climbs out of the repository matches
 * none of them and is refused rather than normalised into one that does.
 */
const resolveBeside = (file: string, relative: string): string | undefined => {
  if (relative.startsWith('/') || relative.includes('\\')) return undefined;
  const segments = file.split('/').slice(0, -1);
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? undefined : segments.join('/');
};

/** The innermost class a line sits inside, which is the one whose attributes that line reads. */
const enclosingClass = (module: ModuleFacts, line: number): DefinitionFact | undefined => {
  let innermost: DefinitionFact | undefined;
  for (const definition of module.definitions) {
    if (definition.kind !== 'class') continue;
    const end = definition.location.endLine ?? definition.location.startLine;
    if (definition.location.startLine > line || end < line) continue;
    const width = end - definition.location.startLine;
    const best =
      innermost === undefined
        ? undefined
        : (innermost.location.endLine ?? innermost.location.startLine) -
          innermost.location.startLine;
    if (best === undefined || width < best) innermost = definition;
  }
  return innermost;
};

/**
 * The one literal a class body binds to this attribute, or nothing where it binds more than one.
 *
 * Listing every literal is what the fact model does and choosing between them is what it refuses to do, so a
 * class that writes two different paths to one attribute has said nothing this can act on. An attribute whose
 * value comes from a call carries no literal at all, which is `screenplay_writer.py` writing
 * `agents_config = yaml.safe_load(file)`: the document is assembled while the program runs and the syntax
 * says so.
 */
const classAttributeLiteral = (
  module: ModuleFacts,
  owner: DefinitionFact,
  attribute: string,
): string | undefined => {
  const ownerEnd = owner.location.endLine ?? owner.location.startLine;
  const values = new Set<string>();
  for (const definition of module.definitions) {
    if (definition.kind !== 'variable' || definition.name !== attribute) continue;
    if (definition.enclosing !== owner.name) continue;
    if (definition.location.startLine < owner.location.startLine) continue;
    if (definition.location.startLine > ownerEnd) continue;
    for (const literal of definition.literals ?? []) {
      const value = stringValue(literal);
      if (value !== undefined) values.add(value);
    }
  }
  const [only] = values;
  return values.size === 1 ? only : undefined;
};

/**
 * The declared entry an `Agent(config=self.agents_config['lead_market_analyst'])` call selects.
 *
 * This is the join `crewai create crew` writes and this build declined to make, and every step of it is now
 * a fact rather than a guess: the subscript carries its literal key, the class attribute carries the literal
 * path, and the path resolves beside the file that wrote it. Where all three hold, the call and the document
 * entry are one agent and the call adds a source location to the component the document already declared.
 *
 * Where any of them does not hold this returns nothing and the call names itself as before. The substitute
 * that returning nothing avoids is the enclosing method name, which was measured on the pinned examples
 * repository at 31 of 50 correct: an `_agent` suffix the key lacks, a call in a class body naming the class,
 * and a crew whose document describes a different crew each break it, and none of the three can be told apart
 * from a match. A key the document does not declare is refused for the same reason: three keys selected in
 * `email_filter_crew.py` name entries a document declaring one does not have, which is a defect in that
 * repository rather than a licence to attach the call to whatever else is there.
 */
const configuredEntry = (
  module: ModuleFacts,
  call: CallFact,
  entries: readonly ObjectEntryFact[],
  documents: AgentsDocuments,
): { readonly documentPath: string; readonly name: string } | undefined => {
  const selector = findEntry(entries, 'config')?.value;
  if (selector === undefined || selector.kind !== 'member') return undefined;
  const key = selector.path.at(-1);
  const attribute = selector.path.at(-2);
  if (key === undefined || attribute === undefined) return undefined;
  const owner = enclosingClass(module, call.location.startLine);
  if (owner === undefined) return undefined;
  const declared = classAttributeLiteral(module, owner, attribute);
  if (declared === undefined) return undefined;
  const documentPath = resolveBeside(module.file, declared);
  if (documentPath === undefined) return undefined;
  const name = documents.get(documentPath)?.get(key);
  return name === undefined ? undefined : { documentPath, name };
};

const discoverAgentCalls = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  files: Set<string>,
  documents: AgentsDocuments,
): { components: number; declinedRoles: number } => {
  let components = 0;
  let declinedRoles = 0;
  for (const match of matchCalls(context.modules, { names: ['Agent'], packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const role = stringValue(findEntry(entries, 'role')?.value);
    const reported = reportedRole(role);
    if (role !== undefined && reported === undefined) declinedRoles += 1;
    const configured = configuredEntry(match.module, match.call, entries, documents);
    const name = configured?.name ?? agentNameFor(role, definition?.name, match.call.enclosing);
    const goal = stringValue(findEntry(entries, 'goal')?.value);
    const identity =
      configured === undefined
        ? sourceIdentity('agent', match.module.file, name)
        : configIdentity('agent', configured.documentPath, name);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        file: match.module.file,
        name,
        identity,
        location: match.call.location,
        symbol: definition?.name ?? 'Agent',
        confidence: match.confidence,
        ...(goal === undefined ? {} : { description: goal.slice(0, 240) }),
        details: { for: 'agent', framework: 'crewai', role: 'worker' },
        metadata: { framework: 'crewai', ...runtimeNameOf(reported) },
        tags: ['crewai'],
      }),
    );
    /*
     * A call that resolved to a declared entry is the same agent the document already added, so it adds a
     * source location to that component rather than a component. Counting it again would report two found
     * where one exists, which is what the two passes did before this join was available.
     */
    if (configured === undefined) components += 1;
    files.add(match.module.file);
    if (definition !== undefined) {
      context.bindings.register(match.module.file, definition.name, identity);
    }
    context.bindings.register(match.module.file, name, identity);
  }
  return { components, declinedRoles };
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
  documents: AgentsDocuments,
): SourceCounts => {
  const files = new Set<string>();
  const agents = discoverAgentCalls(context, builder, files, documents);
  const crews = discoverCrewCalls(context, builder, files);
  return {
    components: agents.components + crews.components,
    edges: crews.edges,
    declinedRoles: agents.declinedRoles,
    files,
  };
};

export const crewAiAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  packages: PACKAGES,
  /*
   * A crew document is a name CrewAI owns outright, so its presence is the repository saying so even where
   * the dependency is installed outside the manifest this build can read. An agents document is not: the
   * name belongs to no framework, and the gate above requires the dependency for every one of them, which
   * leaves nothing here for an agents document to open.
   */
  appliesTo: (context) =>
    projectUses(context, PACKAGES) ||
    context.configs.some((document) => document.path === 'crew.jsonc'),
  discover: (context, builder): AdapterFindings => {
    const fromConfig = discoverFromConfig(context, builder);
    const fromSource = discoverFromSource(context, builder, fromConfig.documents);
    /*
     * Counted from both passes, because a role is declined the same way wherever it was written and a count
     * of only one half told a reader that one of two templates had been declined.
     */
    const declinedRoles = fromConfig.declinedRoles + fromSource.declinedRoles;
    return {
      componentsFound: fromConfig.components + fromSource.components,
      edgesFound: fromConfig.edges + fromSource.edges,
      filesInspected: [...fromSource.files, ...fromConfig.files],
      ...(declinedRoles === 0
        ? {}
        : {
            note: `${formatCount(declinedRoles, 'declared role is', 'declared roles are')} not a name a run can report, a template such as {topic} Researcher or a value that is not a string, so none of them is claimed as one`,
          }),
    };
  },
};
