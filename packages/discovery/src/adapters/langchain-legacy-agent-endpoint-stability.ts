import type { SourceLocation } from '@orchescope/schema';
import type { AssignmentFact, CallFact } from '@orchescope/source-analysis';
import type { DiscoveryContext } from '../adapter.ts';
import { hasBindingAt, matchRuntimeSymbol } from '../matching.ts';
import type { LegacyConstruction } from './langchain-legacy-agent-settlement.ts';
import { legacyArgumentMentions } from './langchain-legacy-agent-settlement.ts';

export type LegacyEndpointChange = {
  readonly kind: 'escape' | 'proven_mutation' | 'unsettled_call';
  readonly location: SourceLocation;
};

export type LegacyEndpointStability = {
  readonly modelChange: LegacyEndpointChange | undefined;
  readonly promptChange: LegacyEndpointChange | undefined;
  readonly toolsChange: LegacyEndpointChange | undefined;
};

const READ_OR_EXECUTE_METHODS = new Set([
  'aapply',
  'abatch',
  'ainvoke',
  'arun',
  'astream',
  'astream_events',
  'astream_log',
  'apply',
  'batch',
  'copy',
  'count',
  'get_graph',
  'index',
  'invoke',
  'iter',
  'run',
  'stream',
]);

const endsBefore = (left: SourceLocation, right: SourceLocation): boolean => {
  const line = left.endLine ?? left.startLine;
  if (line !== right.startLine) return line < right.startLine;
  return (left.endColumn ?? Number.MAX_SAFE_INTEGER) <= (right.startColumn ?? 0);
};

type BindingUse = {
  readonly enclosing?: string | undefined;
  readonly location: SourceLocation;
};

const rootBindingOwns = (
  construction: LegacyConstruction,
  name: string,
  use: BindingUse,
): boolean => {
  const enclosing = construction.definition.enclosing;
  if (use.enclosing === enclosing) return true;
  if (
    enclosing !== undefined &&
    use.enclosing?.startsWith(`${enclosing}.`) === true &&
    !hasBindingAt(construction.module, use.enclosing, name, use.location)
  ) {
    return true;
  }
  return (
    enclosing === undefined && !hasBindingAt(construction.module, use.enclosing, name, use.location)
  );
};

const canRunAfterConstruction = (construction: LegacyConstruction, use: BindingUse): boolean =>
  use.enclosing === construction.definition.enclosing
    ? endsBefore(construction.call.location, use.location)
    : rootBindingOwns(construction, construction.definition.name, use);

const aliasesOf = (construction: LegacyConstruction): ReadonlySet<string> =>
  new Set([construction.definition.name]);

const explicitAttributeMutation = (
  context: DiscoveryContext,
  construction: LegacyConstruction,
  aliases: ReadonlySet<string>,
  call: CallFact,
):
  | {
      readonly kind: 'proven_mutation' | 'unsettled_call';
      readonly member: string;
    }
  | undefined => {
  const leaf = call.calleePath.at(-1) ?? '';
  const binding = call.calleePath[0] ?? '';
  const directBuiltin = call.calleePath.length === 1 && (leaf === 'setattr' || leaf === 'delattr');
  const objectBuiltin =
    call.calleePath.length === 2 &&
    binding === 'object' &&
    (leaf === '__setattr__' || leaf === '__delattr__');
  const importedBuiltin =
    matchRuntimeSymbol(
      context.modules,
      construction.module,
      {
        path: call.calleePath,
        origin: call.origin,
        enclosing: call.enclosing,
        location: call.location,
      },
      { names: ['setattr', 'delattr'], packages: ['builtins'] },
    ) !== undefined;
  const shadowed =
    hasBindingAt(construction.module, call.enclosing, binding, call.location) ||
    construction.module.imports.some(
      (entry) => entry.local === binding && endsBefore(entry.location, call.location),
    ) ||
    construction.module.definitions.some(
      (definition) =>
        definition.enclosing === undefined &&
        definition.name === binding &&
        endsBefore(definition.location, call.location),
    ) ||
    construction.module.assignments.some(
      (assignment) =>
        assignment.enclosing === undefined &&
        assignment.target.length === 1 &&
        assignment.target[0] === binding &&
        endsBefore(assignment.location, call.location),
    );
  if ((!directBuiltin && !objectBuiltin && !importedBuiltin) || (!importedBuiltin && shadowed)) {
    return undefined;
  }
  const root = call.args[0];
  const member = call.args[1];
  if (root?.kind !== 'identifier' || !aliases.has(root.name)) return undefined;
  const name = member?.kind === 'string' ? member.value : '*';
  return {
    kind: name === 'agent' || name === 'tools' ? 'proven_mutation' : 'unsettled_call',
    member: name,
  };
};

type EndpointMutation = {
  readonly kind: 'proven_mutation' | 'unsettled_call';
  readonly member: string;
};

const mutationMember = (
  context: DiscoveryContext,
  construction: LegacyConstruction,
  aliases: ReadonlySet<string>,
  input: AssignmentFact | CallFact,
): EndpointMutation | undefined => {
  if (!canRunAfterConstruction(construction, input)) return undefined;
  if ('calleePath' in input) {
    const explicit = explicitAttributeMutation(context, construction, aliases, input);
    if (explicit !== undefined) return explicit;
  }
  const path = 'target' in input ? input.target : input.calleePath;
  const root = path[0];
  if (root === undefined || !aliases.has(root)) return undefined;
  if ('target' in input) {
    const member = path[1] ?? '*';
    return {
      kind:
        input.targetIncludesSubscript !== true &&
        path.length === 2 &&
        (member === 'agent' || member === 'tools')
          ? 'proven_mutation'
          : 'unsettled_call',
      member,
    };
  }
  const leaf = path.at(-1) ?? '';
  if (READ_OR_EXECUTE_METHODS.has(leaf)) {
    return undefined;
  }
  if (path.length === 2 && path[1]?.includes('tool') === true) {
    return { kind: 'unsettled_call', member: 'tools' };
  }
  return { kind: 'unsettled_call', member: path[1] ?? '*' };
};

const escapedThroughValue = (
  construction: LegacyConstruction,
  aliases: ReadonlySet<string>,
): SourceLocation | undefined => {
  const escapedDefinition = construction.module.definitions.find((definition) => {
    const value = definition.value;
    return (
      canRunAfterConstruction(construction, definition) &&
      value !== undefined &&
      [...aliases].some((name) => legacyArgumentMentions(value, name))
    );
  });
  if (escapedDefinition !== undefined) return escapedDefinition.location;
  return construction.module.assignments.find(
    (assignment) =>
      canRunAfterConstruction(construction, assignment) &&
      [...aliases].some((name) => legacyArgumentMentions(assignment.value, name)),
  )?.location;
};

/** Proves which delegated endpoints remain stable after an executor binding is constructed. */
export const legacyEndpointStability = (
  context: DiscoveryContext,
  construction: LegacyConstruction,
): LegacyEndpointStability => {
  const aliases = aliasesOf(construction);
  let modelChange: LegacyEndpointChange | undefined;
  let promptChange: LegacyEndpointChange | undefined;
  let toolsChange: LegacyEndpointChange | undefined;
  const escapedAt = escapedThroughValue(construction, aliases);
  if (escapedAt !== undefined) {
    const change = { kind: 'escape' as const, location: escapedAt };
    return {
      modelChange: change,
      promptChange: change,
      toolsChange: change,
    };
  }
  const record = (mutation: EndpointMutation, location: SourceLocation): void => {
    const change = { kind: mutation.kind, location };
    if (mutation.member === 'tools') toolsChange ??= change;
    else if (mutation.member === 'agent') {
      modelChange ??= change;
      promptChange ??= change;
    } else {
      modelChange ??= change;
      promptChange ??= change;
      toolsChange ??= change;
    }
  };
  for (const assignment of construction.module.assignments) {
    const mutation = mutationMember(context, construction, aliases, assignment);
    if (mutation !== undefined) record(mutation, assignment.location);
  }
  for (const call of construction.module.calls) {
    const mutation = mutationMember(context, construction, aliases, call);
    if (mutation !== undefined) record(mutation, call.location);
  }
  return { modelChange, promptChange, toolsChange };
};
