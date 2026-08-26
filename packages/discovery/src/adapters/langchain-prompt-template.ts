import type { SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry } from '@orchescope/source-analysis';

import type { DiscoveryContext } from '../adapter.ts';
import { nestedCallableReachabilityBefore } from '../callable-reachability.ts';
import { matchRuntimeSymbol, moduleMatches } from '../matching.ts';
import { lexicalPromptOwner, resolvePromptDefinition } from '../prompt-binding.ts';
import type { SourcePromptInput } from '../prompt-input.ts';
import { promptCallSupport } from '../prompt-input.ts';
import { settlePromptInput } from '../prompt-settlement.ts';

/**
 * The distributions this reader matches prompt template constructions against.
 *
 * Exported because the adapter that consumes this reader has to claim what the reader reads. It did not,
 * and the consequence was a document contradicting itself about one line: `ai-article-writer` recorded
 * `langchain_core.ChatPromptTemplate is constructed at outline_generator1.py:358 and no adapter claims that
 * distribution`, while the same scan read that exact construction into `prompt:planner_node.prompt.human`
 * and `prompt:planner_node.prompt.system` and called it exact in two pinned refusals. A reader saying it
 * does not read a name it reads is worse than silence, because silence is at least consistent.
 *
 * Only these three submodules. `langchain_core` claimed whole silences thirteen
 * `langchain_core.messages.ToolMessage` constructions on three pinned repositories that no reader touches,
 * which is manufactured silence rather than a correction.
 */
export const LANGCHAIN_PROMPT_TEMPLATE_PACKAGES = [
  'langchain_core.prompts',
  'langchain.prompts',
  '@langchain/core/prompts',
] as const;

const PACKAGES = LANGCHAIN_PROMPT_TEMPLATE_PACKAGES;
const CONSTRUCTORS = new Set(['from_template', 'fromTemplate', 'from_messages', 'fromMessages']);
const INVOCATIONS = new Set(['invoke', 'format', 'format_messages', 'formatMessages']);

type Refusal = { readonly reason: string; readonly location: SourceLocation };
type Candidate = {
  readonly module: ModuleFacts;
  readonly constructor: CallFact;
  readonly ownerCall: CallFact;
  readonly kind: 'template' | 'messages';
  readonly definition?: DefinitionFact;
  readonly identityName?: string;
};

const samePath = (left: readonly string[] | undefined, right: readonly string[]): boolean =>
  left !== undefined &&
  left.length === right.length &&
  left.every((part, index) => part === right[index]);

const startsBefore = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine < right.startLine ||
  (left.startLine === right.startLine && (left.startColumn ?? 0) < (right.startColumn ?? 0));

const sameRange = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine === right.startLine &&
  left.startColumn === right.startColumn &&
  left.endLine === right.endLine &&
  left.endColumn === right.endColumn;

const contains = (outer: SourceLocation, inner: SourceLocation): boolean => {
  const outerEnd = outer.endLine ?? outer.startLine;
  const innerEnd = inner.endLine ?? inner.startLine;
  return (
    !(
      outer.startLine === inner.startLine &&
      outer.startColumn === inner.startColumn &&
      outer.endLine === inner.endLine &&
      outer.endColumn === inner.endColumn
    ) &&
    (outer.startLine < inner.startLine ||
      (outer.startLine === inner.startLine &&
        (outer.startColumn ?? 0) <= (inner.startColumn ?? 0))) &&
    (outerEnd > innerEnd ||
      (outerEnd === innerEnd &&
        (outer.endColumn ?? Number.MAX_SAFE_INTEGER) >= (inner.endColumn ?? 0)))
  );
};

const directDefinition = (module: ModuleFacts, call: CallFact): DefinitionFact | undefined => {
  const definitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      samePath(definition.initializer, call.calleePath) &&
      contains(definition.location, call.location),
  );
  if (definitions.length !== 1 || definitions[0] === undefined) return undefined;
  const definition = definitions[0];
  const nestedInAnotherCall = module.calls.some(
    (candidate) =>
      candidate !== call &&
      contains(definition.location, candidate.location) &&
      contains(candidate.location, call.location),
  );
  return nestedInAnotherCall ? undefined : definition;
};

const partialContainer = (module: ModuleFacts, templateCall: CallFact): CallFact | undefined =>
  module.calls
    .filter(
      (call) =>
        call.calleePath.at(-1) === 'partial' &&
        call.calleePath.length === templateCall.calleePath.length + 1 &&
        templateCall.calleePath.every((part, index) => call.calleePath[index] === part) &&
        contains(call.location, templateCall.location),
    )
    .sort((left, right) => {
      const leftLines =
        (left.location.endLine ?? left.location.startLine) - left.location.startLine;
      const rightLines =
        (right.location.endLine ?? right.location.startLine) - right.location.startLine;
      return leftLines - rightLines;
    })[0];

const templateConstructorKind = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): Candidate['kind'] | undefined => {
  const method = call.calleePath.at(-1);
  const methodConstruction = method !== undefined && CONSTRUCTORS.has(method);
  if (
    !methodConstruction &&
    ((call.origin?.imported === 'ChatPromptTemplate' && call.calleePath.length !== 1) ||
      (call.origin?.imported === '*' && call.calleePath.at(-1) !== 'ChatPromptTemplate'))
  ) {
    return undefined;
  }
  const symbol = methodConstruction ? call.calleePath.slice(0, -1) : call.calleePath;
  const matched = matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: symbol,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: ['ChatPromptTemplate'], packages: PACKAGES },
  );
  if (matched === undefined) return undefined;
  if (!methodConstruction) return 'messages';
  return method?.includes('messages') === true || method?.includes('Messages') === true
    ? 'messages'
    : 'template';
};

const semanticIdentity = (
  module: ModuleFacts,
  definition: DefinitionFact | undefined,
): string | undefined => {
  if (definition === undefined || definition.enclosingUnresolved === true) return undefined;
  const leaf = definition.name.split('.').at(-1);
  if (leaf === undefined || leaf.length === 0) return undefined;
  const owner = lexicalPromptOwner(module, definition.location);
  if (
    owner !== undefined &&
    module.definitions.filter(
      (candidate) =>
        (candidate.kind === 'function' || candidate.kind === 'method') &&
        lexicalPromptOwner(module, candidate.location) === owner,
    ).length !== 1
  ) {
    return undefined;
  }
  return owner === undefined ? leaf : `${owner}.${leaf}`;
};

const candidates = (context: DiscoveryContext): readonly Candidate[] =>
  context.modules.flatMap((module) =>
    module.calls.flatMap((templateCall) => {
      const kind = templateConstructorKind(context, module, templateCall);
      if (kind === undefined) return [];
      const container = partialContainer(module, templateCall);
      const ownerCall = container ?? templateCall;
      const definition = directDefinition(module, ownerCall);
      const identityName = semanticIdentity(module, definition);
      return [
        {
          module,
          constructor: templateCall,
          ownerCall,
          kind,
          ...(definition === undefined ? {} : { definition }),
          ...(identityName === undefined ? {} : { identityName }),
        },
      ];
    }),
  );

const keywordValue = (call: CallFact, key: string): ArgumentFact | undefined => {
  const keywords = call.args.find(
    (argument) => argument.kind === 'object' && argument.role === 'keywords',
  );
  return keywords?.kind === 'object' ? findEntry(keywords.entries, key)?.value : undefined;
};

const positionalValue = (call: CallFact): ArgumentFact | undefined =>
  call.args.find((argument) => argument.kind !== 'object' || argument.role !== 'keywords');

const constructorValue = (candidate: Candidate): ArgumentFact | undefined =>
  keywordValue(candidate.constructor, candidate.kind === 'messages' ? 'messages' : 'template') ??
  positionalValue(candidate.constructor);

const placeholderNames = (text: string): readonly string[] => [
  ...new Set(
    [...text.matchAll(/(?<!\{)\{([A-Za-z_][A-Za-z0-9_.]*)\}(?!\})/gu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  ),
];

type ValueSettlement = {
  readonly status: 'static' | 'runtime' | 'unknown';
  readonly locations: readonly SourceLocation[];
};

const parameterBinding = (
  module: ModuleFacts,
  call: CallFact,
  name: string,
): SourceLocation | undefined => {
  const candidates = module.definitions.filter(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      definition.parameters?.some((parameter) => parameter.name === name) === true &&
      (call.enclosingLocation === undefined ||
        (definition.location.startLine === call.enclosingLocation.startLine &&
          definition.location.startColumn === call.enclosingLocation.startColumn &&
          definition.location.endLine === call.enclosingLocation.endLine &&
          definition.location.endColumn === call.enclosingLocation.endColumn)),
  );
  return candidates.length === 1
    ? candidates[0]?.parameters?.find((parameter) => parameter.name === name)?.location
    : undefined;
};

const settleSourceValue = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact,
  before: SourceLocation,
  depth = 0,
): ValueSettlement => {
  if (depth >= 4) return { status: 'unknown', locations: [] };
  if (['string', 'number', 'boolean', 'null'].includes(value.kind)) {
    return { status: 'static', locations: [] };
  }
  if (value.kind === 'template') {
    return {
      status: value.hasSubstitutions === false ? 'static' : 'unknown',
      locations: [],
    };
  }
  if (value.kind === 'identifier') {
    const resolved = resolvePromptDefinition(
      context,
      module,
      value.name,
      call.lexicalEnclosing ?? call.enclosing,
      before,
      call.lexicalScopes ?? [],
      call.lexicalShadows ?? [],
    );
    if (resolved?.definition.value === undefined) {
      const parameter = parameterBinding(module, call, value.name);
      return parameter === undefined
        ? { status: 'unknown', locations: [] }
        : { status: 'runtime', locations: [parameter] };
    }
    const nested = settleSourceValue(
      context,
      resolved.module,
      call,
      resolved.definition.value,
      resolved.definition.location,
      depth + 1,
    );
    return {
      ...nested,
      locations: [resolved.definition.location, ...nested.locations],
    };
  }
  if (value.kind === 'array' && value.complete === true) {
    const nested = value.items.map((item) =>
      settleSourceValue(context, module, call, item, before, depth + 1),
    );
    return {
      status: nested.some((item) => item.status === 'unknown')
        ? 'unknown'
        : nested.some((item) => item.status === 'runtime')
          ? 'runtime'
          : 'static',
      locations: nested.flatMap((item) => item.locations),
    };
  }
  if (value.kind === 'object' && value.complete === true) {
    const nested = value.entries.map((entry) =>
      settleSourceValue(context, module, call, entry.value, entry.location, depth + 1),
    );
    return {
      status: nested.some((item) => item.status === 'unknown')
        ? 'unknown'
        : nested.some((item) => item.status === 'runtime')
          ? 'runtime'
          : 'static',
      locations: nested.flatMap((item) => item.locations),
    };
  }
  return { status: 'unknown', locations: [] };
};

const sameScope = (definition: DefinitionFact, call: CallFact): boolean => {
  const owner = definition.enclosingLocation ?? definition.lexicalOwnerLocation;
  return owner === undefined || call.enclosingLocation === undefined
    ? definition.enclosing === call.enclosing
    : owner.startLine === call.enclosingLocation.startLine &&
        owner.startColumn === call.enclosingLocation.startColumn &&
        owner.endLine === call.enclosingLocation.endLine &&
        owner.endColumn === call.enclosingLocation.endColumn;
};

const sameDefinitionOwner = (left: DefinitionFact, right: DefinitionFact): boolean => {
  const leftOwner = left.enclosingLocation ?? left.lexicalOwnerLocation;
  const rightOwner = right.enclosingLocation ?? right.lexicalOwnerLocation;
  if (leftOwner === undefined || rightOwner === undefined)
    return left.enclosing === right.enclosing;
  return (
    leftOwner.startLine === rightOwner.startLine &&
    leftOwner.startColumn === rightOwner.startColumn &&
    leftOwner.endLine === rightOwner.endLine &&
    leftOwner.endColumn === rightOwner.endColumn
  );
};

const bindingChangeBefore = (
  module: ModuleFacts,
  definition: DefinitionFact,
  location: SourceLocation,
): SourceLocation | undefined => {
  const assignment = module.assignments.find(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === definition.name.split('.').at(-1) &&
      assignment.enclosing === definition.enclosing &&
      startsBefore(definition.location, assignment.location) &&
      startsBefore(assignment.location, location),
  )?.location;
  const redefinition = module.definitions.find(
    (candidate) =>
      candidate !== definition &&
      candidate.kind === 'variable' &&
      candidate.name === definition.name &&
      sameDefinitionOwner(definition, candidate) &&
      startsBefore(definition.location, candidate.location) &&
      startsBefore(candidate.location, location),
  )?.location;
  if (assignment === undefined) return redefinition;
  if (redefinition === undefined) return assignment;
  return startsBefore(assignment, redefinition) ? assignment : redefinition;
};

const exactInvocations = (candidate: Candidate): readonly CallFact[] => {
  const binding = candidate.definition?.name.split('.').at(-1);
  if (binding === undefined || candidate.definition === undefined) return [];
  return candidate.module.calls.filter(
    (call) =>
      call.calleePath.length === 2 &&
      call.calleePath[0] === binding &&
      INVOCATIONS.has(call.calleePath[1] ?? '') &&
      sameScope(candidate.definition as DefinitionFact, call) &&
      startsBefore(candidate.ownerCall.location, call.location),
  );
};

const branchKey = (fact: { readonly branches?: CallFact['branches'] }): string =>
  JSON.stringify(
    (fact.branches ?? []).map((branch) => ({
      operator: branch.operator,
      branch: branch.branch,
      location: branch.location,
    })),
  );

const partialBindings = (candidate: Candidate) => {
  const values = new Map<string, ObjectEntryFact>();
  const remember = (entries: readonly ObjectEntryFact[]) => {
    for (const entry of entries) values.set(entry.key, entry);
  };
  const constructorPartials = keywordValue(candidate.constructor, 'partial_variables');
  if (constructorPartials?.kind === 'object' && constructorPartials.complete === true) {
    remember(constructorPartials.entries);
  }
  if (candidate.ownerCall.calleePath.at(-1) === 'partial') {
    const supplied = candidate.ownerCall.args.find((argument) => argument.kind === 'object');
    if (supplied?.kind === 'object' && supplied.complete === true) remember(supplied.entries);
  }
  return values;
};

const templateFormatRefusal = (
  context: DiscoveryContext,
  candidate: Candidate,
): { readonly reason: string; readonly location: SourceLocation } | undefined => {
  const format = keywordValue(candidate.constructor, 'template_format');
  if (format === undefined) return undefined;
  const settled = settlePromptInput(
    context,
    candidate.module,
    format,
    candidate.constructor.location,
    candidate.constructor.lexicalEnclosing ?? candidate.constructor.enclosing,
    [candidate.constructor.location],
    candidate.constructor.lexicalScopes ?? [],
    candidate.constructor.lexicalShadows ?? [],
  );
  const exact = settled.leaves.length === 1 ? settled.leaves[0]?.value.value : undefined;
  if (exact === undefined || settled.reason !== undefined) {
    return {
      reason: 'template_format is computed, so placeholder syntax was not classified',
      location: candidate.constructor.location,
    };
  }
  return exact === 'f-string'
    ? undefined
    : {
        reason: `template_format ${exact} is not interpreted by this source reader`,
        location: candidate.constructor.location,
      };
};

const argumentMentions = (value: ArgumentFact, name: string): boolean => {
  if (value.kind === 'identifier') return value.name === name;
  if (value.kind === 'member') return value.path[0] === name;
  if (value.kind === 'array') return value.items.some((item) => argumentMentions(item, name));
  if (value.kind === 'call') return value.args.some((argument) => argumentMentions(argument, name));
  if (value.kind === 'selection') {
    return value.alternatives.some((alternative) => argumentMentions(alternative.value, name));
  }
  if (value.kind !== 'object') return false;
  return (
    value.entries.some((entry) => argumentMentions(entry.value, name)) ||
    value.spreads?.some((spread) => argumentMentions(spread.value, name)) === true
  );
};

const definitionOwnerLocation = (definition: DefinitionFact): SourceLocation | undefined =>
  definition.enclosingLocation ?? definition.lexicalOwnerLocation;

const assignmentTargetsBinding = (
  definition: DefinitionFact,
  assignment: ModuleFacts['assignments'][number],
): boolean => {
  const name = definition.name.split('.').at(-1);
  if (assignment.target[0] !== name) return false;
  const owner = definitionOwnerLocation(definition);
  if (assignment.bindingScope === 'global') return owner === undefined;
  if (assignment.bindingScope === 'nonlocal') {
    return (
      owner !== undefined &&
      assignment.bindingOwnerLocation !== undefined &&
      sameRange(owner, assignment.bindingOwnerLocation)
    );
  }
  const assignmentOwner = assignment.enclosingLocation ?? assignment.lexicalOwnerLocation;
  return owner === undefined
    ? assignmentOwner === undefined && assignment.enclosing === definition.enclosing
    : assignmentOwner !== undefined && sameRange(owner, assignmentOwner);
};

const definitionTargetsBinding = (
  definition: DefinitionFact,
  candidate: DefinitionFact,
): boolean => {
  if (candidate.name !== definition.name) return false;
  const owner = definitionOwnerLocation(definition);
  if (candidate.bindingScope === 'global') return owner === undefined;
  if (candidate.bindingScope === 'nonlocal') {
    return (
      owner !== undefined &&
      candidate.bindingOwnerLocation !== undefined &&
      sameRange(owner, candidate.bindingOwnerLocation)
    );
  }
  return sameDefinitionOwner(definition, candidate);
};

const reachabilityIssue = (
  module: ModuleFacts,
  definition: DefinitionFact,
  nested: DefinitionFact,
  invocation: CallFact,
  mutation: SourceLocation,
): SourceLocation | undefined => {
  const reachability = nestedCallableReachabilityBefore(module, definition, nested, invocation);
  if (reachability.status === 'reached') return mutation;
  return reachability.status === 'unknown' ? (reachability.location ?? mutation) : undefined;
};

const nestedAssignmentIssue = (
  module: ModuleFacts,
  definition: DefinitionFact,
  invocation: CallFact,
  name: string,
): SourceLocation | undefined => {
  for (const assignment of module.assignments) {
    if (
      assignment.target.length < 2 ||
      assignment.target[0] !== name ||
      assignment.lexicalOwnerLocation === undefined
    ) {
      continue;
    }
    const nested = module.definitions.find(
      (candidate) =>
        (candidate.kind === 'function' || candidate.kind === 'method') &&
        sameRange(candidate.location, assignment.lexicalOwnerLocation as SourceLocation),
    );
    if (nested === undefined) continue;
    const issue = reachabilityIssue(module, definition, nested, invocation, assignment.location);
    if (issue !== undefined) return issue;
  }
  return undefined;
};

const capturedDefaultIssue = (
  module: ModuleFacts,
  definition: DefinitionFact,
  invocation: CallFact,
  name: string,
): SourceLocation | undefined => {
  for (const candidate of module.definitions) {
    const captures =
      (candidate.kind === 'function' || candidate.kind === 'method') &&
      candidate.parameters?.some(
        (parameter) =>
          parameter.defaultValue !== undefined && argumentMentions(parameter.defaultValue, name),
      ) === true;
    if (!captures) continue;
    const issue = reachabilityIssue(module, definition, candidate, invocation, candidate.location);
    if (issue !== undefined) return issue;
  }
  return undefined;
};

const builtinSetterMutation = (module: ModuleFacts, call: CallFact, name: string): boolean => {
  const setter = call.calleePath.length === 1 ? call.calleePath[0] : undefined;
  if (setter !== 'setattr' && setter !== 'delattr') return false;
  const positional = call.args.filter(
    (argument) => argument.kind !== 'object' || argument.role !== 'keywords',
  );
  return (
    call.origin === undefined &&
    call.lexicalScopes?.every((scope) => !scope.bindings.includes(setter)) !== false &&
    !module.imports.some((entry) => entry.local === setter && !entry.isType) &&
    !module.definitions.some(
      (candidate) =>
        candidate.name.split('.').at(-1) === setter &&
        definitionOwnerLocation(candidate) === undefined &&
        startsBefore(candidate.location, call.location),
    ) &&
    positional[0] !== undefined &&
    argumentMentions(positional[0], name) &&
    positional[1] !== undefined
  );
};

const nestedSetterIssue = (
  module: ModuleFacts,
  definition: DefinitionFact,
  invocation: CallFact,
  name: string,
): SourceLocation | undefined => {
  for (const call of module.calls) {
    if (!builtinSetterMutation(module, call, name) || call.enclosingLocation === undefined)
      continue;
    const nested = module.definitions.find(
      (candidate) =>
        (candidate.kind === 'function' || candidate.kind === 'method') &&
        sameRange(candidate.location, call.enclosingLocation as SourceLocation),
    );
    if (nested === undefined) continue;
    const issue = reachabilityIssue(module, definition, nested, invocation, call.location);
    if (issue !== undefined) return issue;
  }
  return undefined;
};

const bindingIssueBefore = (
  module: ModuleFacts,
  definition: DefinitionFact,
  invocation: CallFact,
): SourceLocation | undefined => {
  const name = definition.name.split('.').at(-1);
  if (name === undefined) return definition.location;
  const capturedWrite = module.assignments.find(
    (assignment) =>
      assignmentTargetsBinding(definition, assignment) &&
      (assignment.bindingScope !== undefined ||
        (startsBefore(definition.location, assignment.location) &&
          startsBefore(assignment.location, invocation.location))),
  );
  if (capturedWrite !== undefined) return capturedWrite.location;
  const nestedAssignment = nestedAssignmentIssue(module, definition, invocation, name);
  if (nestedAssignment !== undefined) return nestedAssignment;
  const capturedDefault = capturedDefaultIssue(module, definition, invocation, name);
  if (capturedDefault !== undefined) return capturedDefault;
  const nestedSetter = nestedSetterIssue(module, definition, invocation, name);
  if (nestedSetter !== undefined) return nestedSetter;
  const owner = definitionOwnerLocation(definition);
  const escapedAssignment = module.assignments.find((assignment) => {
    const assignmentOwner = assignment.enclosingLocation ?? assignment.lexicalOwnerLocation;
    const sameOwner =
      owner === undefined
        ? assignmentOwner === undefined && assignment.enclosing === definition.enclosing
        : assignmentOwner !== undefined && sameRange(owner, assignmentOwner);
    return (
      sameOwner &&
      startsBefore(definition.location, assignment.location) &&
      startsBefore(assignment.location, invocation.location) &&
      (argumentMentions(assignment.value, name) ||
        assignment.sourceReferences?.some((reference) => reference[0] === name) === true)
    );
  });
  if (escapedAssignment !== undefined) return escapedAssignment.location;
  const escapedDefinition = module.definitions.find(
    (candidate) =>
      candidate !== definition &&
      candidate.value !== undefined &&
      ((candidate.name === definition.name &&
        definitionTargetsBinding(definition, candidate) &&
        (candidate.bindingScope !== undefined ||
          (startsBefore(definition.location, candidate.location) &&
            startsBefore(candidate.location, invocation.location)))) ||
        (candidate.name !== definition.name &&
          sameDefinitionOwner(definition, candidate) &&
          startsBefore(definition.location, candidate.location) &&
          startsBefore(candidate.location, invocation.location) &&
          argumentMentions(candidate.value, name))),
  );
  if (escapedDefinition !== undefined) return escapedDefinition.location;
  return module.calls.find(
    (call) =>
      call !== invocation &&
      call.enclosing === invocation.enclosing &&
      startsBefore(definition.location, call.location) &&
      startsBefore(call.location, invocation.location) &&
      (call.calleePath[0] === name ||
        call.args.some((argument) => argumentMentions(argument, name))),
  )?.location;
};

type Interpolation = {
  readonly value?: boolean;
  readonly reason?: string;
  readonly refusalLocation?: SourceLocation;
  readonly support: readonly SourceLocation[];
};

const settlePartialOnlyInterpolation = (
  context: DiscoveryContext,
  candidate: Candidate,
  placeholders: ReadonlySet<string>,
  partials: ReadonlyMap<string, ObjectEntryFact>,
): Interpolation => {
  const support: SourceLocation[] = [];
  let runtime = false;
  for (const name of placeholders) {
    const entry = partials.get(name);
    if (entry === undefined) {
      return {
        reason:
          'the template declares runtime placeholders, but their exact invocation binding was not settled',
        refusalLocation: candidate.ownerCall.location,
        support,
      };
    }
    const binding = settleSourceValue(
      context,
      candidate.module,
      candidate.ownerCall,
      entry.value,
      entry.location,
    );
    support.push(entry.location, ...binding.locations);
    if (binding.status === 'runtime') runtime = true;
    if (binding.status === 'unknown') {
      return {
        reason: `partial binding ${name} is computed or ambiguous`,
        refusalLocation: entry.location,
        support,
      };
    }
  }
  return { value: runtime, support };
};

type InvocationState = {
  readonly runtime: boolean;
  readonly support: readonly SourceLocation[];
};

const invocationRefusal = (
  state: InvocationState,
  reason: string,
  refusalLocation: SourceLocation,
): Interpolation => ({
  ...(state.runtime ? { value: true } : {}),
  reason,
  refusalLocation,
  support: state.support,
});

const settleOneInvocation = (
  context: DiscoveryContext,
  candidate: Candidate & { readonly definition: DefinitionFact },
  placeholders: ReadonlySet<string>,
  partials: ReadonlyMap<string, ObjectEntryFact>,
  invocation: CallFact,
  state: InvocationState,
): { readonly state?: InvocationState; readonly refusal?: Interpolation } => {
  const changed = bindingChangeBefore(candidate.module, candidate.definition, invocation.location);
  if (changed !== undefined) {
    return {
      refusal: invocationRefusal(
        state,
        'the prompt binding is reassigned before this template invocation',
        changed,
      ),
    };
  }
  if (branchKey(candidate.ownerCall) !== branchKey(invocation)) {
    return {
      refusal: invocationRefusal(
        state,
        'template construction and invocation do not share one exact control-flow branch',
        invocation.location,
      ),
    };
  }
  const issue = bindingIssueBefore(candidate.module, candidate.definition, invocation);
  if (issue !== undefined) {
    return {
      refusal: invocationRefusal(
        state,
        'source did not prove that the prompt binding remained stable before invocation',
        issue,
      ),
    };
  }
  const supplied = invocation.args.find((argument) => argument.kind === 'object');
  if (supplied?.kind !== 'object' || supplied.complete !== true) {
    return {
      refusal: invocationRefusal(
        state,
        'template invocation inputs are computed or contain an unresolved spread',
        invocation.location,
      ),
    };
  }
  const support = [...state.support];
  let runtime = state.runtime;
  for (const name of placeholders) {
    const suppliedEntry = supplied.entries.findLast((candidate) => candidate.key === name);
    const entry = suppliedEntry ?? partials.get(name);
    if (entry === undefined) {
      return {
        refusal: invocationRefusal(
          { runtime, support },
          `template invocation does not settle placeholder ${name}`,
          invocation.location,
        ),
      };
    }
    const binding = settleSourceValue(
      context,
      candidate.module,
      invocation,
      entry.value,
      entry.location,
    );
    support.push(entry.location, ...binding.locations);
    if (binding.status === 'runtime') runtime = true;
    if (binding.status === 'unknown') {
      return {
        refusal: invocationRefusal(
          { runtime, support },
          suppliedEntry === undefined
            ? `partial binding ${name} is computed or ambiguous`
            : `template invocation binding ${name} is computed or ambiguous`,
          entry.location,
        ),
      };
    }
  }
  support.push(invocation.location);
  return { state: { runtime, support } };
};

const settleInvocationInterpolation = (
  context: DiscoveryContext,
  candidate: Candidate & { readonly definition: DefinitionFact },
  placeholders: ReadonlySet<string>,
  partials: ReadonlyMap<string, ObjectEntryFact>,
): Interpolation => {
  const invocations = exactInvocations(candidate);
  let state: InvocationState = { runtime: false, support: [] };
  for (const invocation of invocations) {
    const settled = settleOneInvocation(
      context,
      candidate,
      placeholders,
      partials,
      invocation,
      state,
    );
    if (settled.refusal !== undefined) return settled.refusal;
    if (settled.state !== undefined) state = settled.state;
  }
  return invocations.length > 0
    ? { value: state.runtime, support: state.support }
    : settlePartialOnlyInterpolation(context, candidate, placeholders, partials);
};

const interpolationOf = (
  context: DiscoveryContext,
  candidate: Candidate,
  value: ArgumentFact,
): Interpolation => {
  const settlement = settlePromptInput(
    context,
    candidate.module,
    value,
    candidate.constructor.location,
    candidate.constructor.lexicalEnclosing ?? candidate.constructor.enclosing,
    [candidate.constructor.location],
    candidate.constructor.lexicalScopes ?? [],
    candidate.constructor.lexicalShadows ?? [],
  );
  const placeholders = new Set(
    settlement.leaves.flatMap((leaf) => placeholderNames(leaf.value.value)),
  );
  const formatRefusal = templateFormatRefusal(context, candidate);
  if (formatRefusal !== undefined) {
    return {
      reason: formatRefusal.reason,
      refusalLocation: formatRefusal.location,
      support: [],
    };
  }
  if (placeholders.size === 0) return { value: false, support: [] };
  const partials = partialBindings(candidate);
  return candidate.definition === undefined
    ? {
        reason: 'the template has no stable binding for invocation settlement',
        refusalLocation: candidate.ownerCall.location,
        support: [],
      }
    : settleInvocationInterpolation(
        context,
        { ...candidate, definition: candidate.definition },
        placeholders,
        partials,
      );
};

const messageEntries = (
  value: ArgumentFact,
): readonly { readonly role: string; readonly value: ArgumentFact }[] | undefined => {
  if (value.kind !== 'array' || value.complete !== true) return undefined;
  const entries: { role: string; value: ArgumentFact }[] = [];
  for (const item of value.items) {
    if (item.kind !== 'array' || item.complete !== true || item.items.length !== 2)
      return undefined;
    const role = item.items[0];
    const content = item.items[1];
    if (role?.kind !== 'string' || content === undefined) return undefined;
    entries.push({ role: role.value, value: content });
  }
  return new Set(entries.map((entry) => entry.role)).size === entries.length ? entries : undefined;
};

const inputsFor = (
  context: DiscoveryContext,
  candidate: Candidate & { readonly identityName: string },
): { readonly inputs: readonly SourcePromptInput[]; readonly refusals: readonly Refusal[] } => {
  const value = constructorValue(candidate);
  if (value === undefined) {
    return {
      inputs: [],
      refusals: [
        {
          reason: 'ChatPromptTemplate construction has no exact template argument',
          location: candidate.constructor.location,
        },
      ],
    };
  }
  const entries =
    candidate.kind === 'messages' ? messageEntries(value) : [{ role: 'template', value }];
  if (entries === undefined) {
    return {
      inputs: [],
      refusals: [
        {
          reason:
            'ChatPromptTemplate message population is computed, incomplete, or repeats one semantic role',
          location: candidate.constructor.location,
        },
      ],
    };
  }
  const support = [
    ...promptCallSupport(candidate.module, candidate.constructor),
    ...(candidate.definition === undefined ? [] : [candidate.definition.location]),
    ...(candidate.ownerCall === candidate.constructor ? [] : [candidate.ownerCall.location]),
  ];
  return {
    inputs: entries.map((entry) => {
      const interpolation = interpolationOf(context, candidate, entry.value);
      return {
        producer: 'adapter:prompts',
        module: candidate.module,
        call: candidate.ownerCall,
        identityName:
          entry.role === 'template'
            ? candidate.identityName
            : `${candidate.identityName}.${entry.role}`,
        channel: `chat_prompt_template.${entry.role}`,
        value: entry.value,
        location: candidate.constructor.location,
        supportingLocations: [...support, ...interpolation.support],
        ...(interpolation.value === undefined ? {} : { runtimeInterpolation: interpolation.value }),
        ...(interpolation.reason === undefined
          ? {}
          : { interpolationRefusal: interpolation.reason }),
        ...(interpolation.refusalLocation === undefined
          ? {}
          : { interpolationRefusalLocation: interpolation.refusalLocation }),
        relationRefusal:
          'the ChatPromptTemplate construction is exact, but its consuming graph component was not settled',
      };
    }),
    refusals: [],
  };
};

export const hasLangChainPromptTemplateImport = (context: DiscoveryContext): boolean =>
  context.modules.some((module) =>
    module.imports.some(
      (entry) =>
        !entry.isType &&
        moduleMatches(entry.module, PACKAGES) &&
        (entry.imported === 'ChatPromptTemplate' || entry.imported === '*'),
    ),
  );

export const discoverLangChainPromptTemplates = (
  context: DiscoveryContext,
): {
  readonly inputs: readonly SourcePromptInput[];
  readonly refusals: readonly Refusal[];
  readonly files: readonly string[];
} => {
  const found = candidates(context);
  const identities = new Map<string, number>();
  for (const candidate of found) {
    if (candidate.identityName !== undefined) {
      const key = `${candidate.module.file}\u0000${candidate.identityName}`;
      identities.set(key, (identities.get(key) ?? 0) + 1);
    }
  }
  const inputs: SourcePromptInput[] = [];
  const refusals: Refusal[] = [];
  for (const candidate of found) {
    if (candidate.identityName === undefined) {
      refusals.push({
        reason: 'ChatPromptTemplate construction has no stable source binding for graph identity',
        location: candidate.constructor.location,
      });
      continue;
    }
    if ((identities.get(`${candidate.module.file}\u0000${candidate.identityName}`) ?? 0) !== 1) {
      refusals.push({
        reason: `multiple ChatPromptTemplate constructions share source binding ${candidate.identityName}`,
        location: candidate.constructor.location,
      });
      continue;
    }
    const discovered = inputsFor(context, { ...candidate, identityName: candidate.identityName });
    inputs.push(...discovered.inputs);
    refusals.push(...discovered.refusals);
  }
  return {
    inputs,
    refusals,
    files: [...new Set(found.map((candidate) => candidate.module.file))],
  };
};
