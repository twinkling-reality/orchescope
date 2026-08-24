import type { SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
} from '@orchescope/source-analysis';

export type CallableReachability = {
  readonly status: 'reached' | 'clear' | 'unknown';
  readonly location?: SourceLocation;
};

type CallableResolution = {
  readonly definitions: readonly DefinitionFact[];
  readonly incomplete: boolean;
  readonly preservesPrevious?: boolean;
};

type ActiveDefinitionSelection = {
  readonly definitions: readonly DefinitionFact[];
  readonly preservesPrevious: boolean;
};

type LexicalScope = NonNullable<CallFact['lexicalScopes']>[number];
type ResolveCallable = (
  name: string,
  reference: SourceLocation,
  scopes: readonly LexicalScope[],
  branches: CallFact['branches'],
  aliases?: ReadonlySet<string>,
) => CallableResolution;

const MAX_CALLABLE_STEPS = 64;
const MAX_BRANCH_COVERAGE_PREDICATES = 12;

const startsBefore = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine < right.startLine ||
  (left.startLine === right.startLine && (left.startColumn ?? 0) < (right.startColumn ?? 0));

const locationBeforeReference = (location: SourceLocation, reference: SourceLocation): boolean =>
  (location.endLine ?? location.startLine) < reference.startLine ||
  ((location.endLine ?? location.startLine) === reference.startLine &&
    (location.endColumn ?? Number.MAX_SAFE_INTEGER) <=
      (reference.startColumn ?? Number.MAX_SAFE_INTEGER));

const beforeReference = (candidate: DefinitionFact, reference: SourceLocation): boolean =>
  locationBeforeReference(candidate.location, reference);

const sameRange = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine === right.startLine &&
  left.startColumn === right.startColumn &&
  left.endLine === right.endLine &&
  left.endColumn === right.endColumn;

const definitionOwner = (definition: DefinitionFact): SourceLocation | undefined =>
  definition.enclosingLocation ?? definition.lexicalOwnerLocation;

const sameScope = (definition: DefinitionFact, call: CallFact): boolean => {
  const owner = definitionOwner(definition);
  return owner === undefined || call.enclosingLocation === undefined
    ? definition.enclosing === call.enclosing
    : sameRange(owner, call.enclosingLocation);
};

const branchKey = (fact: { readonly branches?: CallFact['branches'] }): string =>
  JSON.stringify(
    (fact.branches ?? []).map((branch) => ({
      operator: branch.operator,
      branch: branch.branch,
      location: branch.location,
    })),
  );

const branchLocationKey = (location: SourceLocation): string =>
  `${location.startLine}:${location.startColumn ?? 0}:${location.endLine ?? location.startLine}:${location.endColumn ?? 0}`;

type BranchChoice = {
  readonly predicate: string;
  readonly branch: 'consequence' | 'alternative';
};

const branchPathsCoverAll = (definitions: readonly DefinitionFact[]): boolean => {
  const paths = definitions.map((definition) => {
    const choices = new Map<string, BranchChoice>();
    for (const branch of definition.branches ?? []) {
      const predicate = branchLocationKey(branch.location);
      choices.set(predicate, { predicate, branch: branch.branch });
    }
    return [...choices.values()];
  });
  const predicateCount = new Set(paths.flatMap((path) => path.map((choice) => choice.predicate)))
    .size;
  if (predicateCount > MAX_BRANCH_COVERAGE_PREDICATES) return false;

  const covers = (remaining: readonly (readonly BranchChoice[])[]): boolean => {
    if (remaining.some((path) => path.length === 0)) return true;
    const predicate = remaining[0]?.[0]?.predicate;
    if (predicate === undefined) return false;
    return (['consequence', 'alternative'] as const).every((branch) => {
      const compatible = remaining
        .filter((path) => {
          const choice = path.find((candidate) => candidate.predicate === predicate);
          return choice === undefined || choice.branch === branch;
        })
        .map((path) => path.filter((choice) => choice.predicate !== predicate));
      return compatible.length > 0 && covers(compatible);
    });
  };

  return paths.length > 0 && covers(paths);
};

const ownerOfReference = (
  name: string,
  scopes: readonly LexicalScope[],
): SourceLocation | undefined =>
  [...scopes].reverse().find((scope) => scope.bindings.includes(name))?.location;

const candidateDefinitions = (
  module: ModuleFacts,
  name: string,
  owner: SourceLocation | undefined,
  reference: SourceLocation,
): readonly DefinitionFact[] =>
  module.definitions
    .filter((candidate) => {
      const candidateOwner = definitionOwner(candidate);
      const sameOwner =
        owner === undefined
          ? candidateOwner === undefined
          : candidateOwner !== undefined && sameRange(owner, candidateOwner);
      return (
        candidate.name.split('.').at(-1) === name &&
        sameOwner &&
        beforeReference(candidate, reference)
      );
    })
    .sort(
      (left, right) =>
        left.location.startLine - right.location.startLine ||
        (left.location.startColumn ?? 0) - (right.location.startColumn ?? 0),
    );

const activeDefinitions = (
  candidates: readonly DefinitionFact[],
  branches: CallFact['branches'],
): ActiveDefinitionSelection => {
  const referenceBranch = branchKey({ branches });
  const exact = candidates.filter((candidate) => branchKey(candidate) === referenceBranch);
  if (referenceBranch !== '[]') {
    const selected = exact.at(-1) ?? candidates.filter((item) => branchKey(item) === '[]').at(-1);
    return {
      definitions: selected === undefined ? [] : [selected],
      preservesPrevious: false,
    };
  }
  const straightLine = exact.at(-1);
  const conditional = candidates.filter(
    (candidate) =>
      branchKey(candidate) !== '[]' &&
      (straightLine === undefined || startsBefore(straightLine.location, candidate.location)),
  );
  const exhaustive = branchPathsCoverAll(conditional);
  return {
    definitions: [...(straightLine === undefined ? [] : [straightLine]), ...conditional],
    preservesPrevious: straightLine === undefined && conditional.length > 0 && !exhaustive,
  };
};

const distinctDefinitions = (definitions: readonly DefinitionFact[]): readonly DefinitionFact[] =>
  definitions.filter(
    (candidate, index) =>
      definitions.findIndex((other) => sameRange(candidate.location, other.location)) === index,
  );

const createCallableResolver = (module: ModuleFacts): ResolveCallable => {
  const resolve: ResolveCallable = (name, reference, scopes, branches, aliases = new Set()) => {
    const active = activeDefinitions(
      candidateDefinitions(module, name, ownerOfReference(name, scopes), reference),
      branches,
    );
    const candidates = active.definitions;
    if (candidates.length === 0) {
      const owner = ownerOfReference(name, scopes);
      const ownerDefinition =
        owner === undefined
          ? undefined
          : module.definitions.find(
              (candidate) =>
                (candidate.kind === 'function' || candidate.kind === 'method') &&
                sameRange(candidate.location, owner),
            );
      const parameter =
        ownerDefinition?.parameters?.some((candidate) => candidate.name === name) === true;
      const unsettledWrite = module.assignments.some((assignment) => {
        const assignmentOwner = assignment.enclosingLocation ?? assignment.lexicalOwnerLocation;
        return (
          assignment.target[0] === name &&
          locationBeforeReference(assignment.location, reference) &&
          (owner === undefined
            ? assignmentOwner === undefined
            : assignmentOwner !== undefined && sameRange(owner, assignmentOwner))
        );
      });
      return { definitions: [], incomplete: unsettledWrite || (!parameter && owner !== undefined) };
    }
    const definitions: DefinitionFact[] = [];
    let incomplete = false;
    for (const candidate of candidates) {
      if (candidate.kind === 'function' || candidate.kind === 'method') {
        definitions.push(candidate);
        incomplete ||= candidate.decorators.length > 0;
        continue;
      }
      if (candidate.value?.kind !== 'identifier') {
        incomplete = true;
        continue;
      }
      const aliasKey = `${candidate.name}:${candidate.location.startLine}:${candidate.location.startColumn ?? 0}`;
      if (aliases.has(aliasKey) || aliases.size >= MAX_CALLABLE_STEPS) {
        incomplete = true;
        continue;
      }
      const nested = resolve(
        candidate.value.name,
        candidate.location,
        scopes,
        candidate.branches,
        new Set(aliases).add(aliasKey),
      );
      definitions.push(...nested.definitions);
      incomplete ||= nested.incomplete || nested.preservesPrevious === true;
    }
    return {
      definitions: distinctDefinitions(definitions),
      incomplete,
      ...(active.preservesPrevious ? { preservesPrevious: true } : {}),
    };
  };
  return resolve;
};

const resolveArgument = (
  value: ArgumentFact | undefined,
  call: CallFact,
  inherited: ReadonlyMap<string, CallableResolution>,
  resolve: ResolveCallable,
): CallableResolution => {
  if (value?.kind !== 'identifier') return { definitions: [], incomplete: true };
  return (
    inherited.get(value.name) ??
    resolve(value.name, call.location, call.lexicalScopes ?? [], call.branches)
  );
};

const invocationBindings = (
  callable: DefinitionFact,
  call: CallFact,
  inherited: ReadonlyMap<string, CallableResolution>,
  resolve: ResolveCallable,
  caller?: DefinitionFact,
): ReadonlyMap<string, CallableResolution> => {
  const callableOwner = definitionOwner(callable);
  const capturesCaller =
    caller !== undefined &&
    callableOwner !== undefined &&
    sameRange(callableOwner, caller.location);
  const bindings = new Map<string, CallableResolution>(capturesCaller ? inherited : []);
  const keywords = call.args.find(
    (argument) => argument.kind === 'object' && argument.role === 'keywords',
  );
  const positional = call.args.filter(
    (argument) => argument.kind !== 'object' || argument.role !== 'keywords',
  );
  for (const [index, parameter] of (callable.parameters ?? []).entries()) {
    const keyword =
      keywords?.kind === 'object'
        ? keywords.entries.findLast((entry) => entry.key === parameter.name)?.value
        : undefined;
    bindings.set(
      parameter.name,
      resolveArgument(
        keyword ?? positional[index] ?? parameter.defaultValue,
        call,
        inherited,
        resolve,
      ),
    );
  }
  return bindings;
};

const callsInside = (module: ModuleFacts, callable: DefinitionFact): readonly CallFact[] =>
  module.calls.filter(
    (call) =>
      call.enclosingLocation !== undefined &&
      sameRange(call.enclosingLocation, callable.location) &&
      call.calleePath.length === 1,
  );

const resolutionAtCall = (
  call: CallFact,
  bindings: ReadonlyMap<string, CallableResolution>,
  resolve: ResolveCallable,
): CallableResolution => {
  const root = call.calleePath[0] ?? '';
  const source = resolve(root, call.location, call.lexicalScopes ?? [], call.branches);
  const inherited = bindings.get(root);
  const settled =
    source.preservesPrevious === true && inherited !== undefined
      ? {
          definitions: distinctDefinitions([...source.definitions, ...inherited.definitions]),
          incomplete: source.incomplete || inherited.incomplete,
        }
      : source.definitions.length > 0 || source.incomplete
        ? source
        : (inherited ?? source);
  return call.invokesReturnedCallable === true
    ? { definitions: settled.definitions, incomplete: true }
    : settled;
};

const reachFromCallable = (
  module: ModuleFacts,
  nested: DefinitionFact,
  callable: DefinitionFact,
  bindings: ReadonlyMap<string, CallableResolution>,
  visited: ReadonlySet<string>,
  state: { steps: number },
  resolve: ResolveCallable,
): CallableReachability => {
  if (sameRange(callable.location, nested.location)) return { status: 'reached' };
  state.steps += 1;
  if (state.steps > MAX_CALLABLE_STEPS) return { status: 'unknown', location: callable.location };
  const key = `${callable.location.startLine}:${callable.location.startColumn ?? 0}:${callable.location.endLine ?? callable.location.startLine}:${callable.location.endColumn ?? 0}`;
  if (visited.has(key)) return { status: 'clear' };
  const nextVisited = new Set(visited).add(key);
  let unknown: SourceLocation | undefined;
  for (const call of callsInside(module, callable)) {
    const resolution = resolutionAtCall(call, bindings, resolve);
    if (resolution.incomplete) unknown ??= call.location;
    for (const target of resolution.definitions) {
      const reached = reachFromCallable(
        module,
        nested,
        target,
        invocationBindings(target, call, bindings, resolve, callable),
        nextVisited,
        state,
        resolve,
      );
      if (reached.status === 'reached') return reached;
      if (reached.status === 'unknown') unknown ??= reached.location ?? call.location;
    }
  }
  return unknown === undefined ? { status: 'clear' } : { status: 'unknown', location: unknown };
};

export const nestedCallableReachabilityBefore = (
  module: ModuleFacts,
  definition: DefinitionFact,
  nested: DefinitionFact,
  invocation: CallFact,
): CallableReachability => {
  const resolve = createCallableResolver(module);
  const state = { steps: 0 };
  let unknown: SourceLocation | undefined;
  for (const call of module.calls) {
    if (
      call.calleePath.length !== 1 ||
      !sameScope(definition, call) ||
      !startsBefore(definition.location, call.location) ||
      !startsBefore(call.location, invocation.location)
    ) {
      continue;
    }
    const sourceResolution = resolve(
      call.calleePath[0] ?? '',
      call.location,
      call.lexicalScopes ?? [],
      call.branches,
    );
    const resolution =
      call.invokesReturnedCallable === true
        ? { definitions: sourceResolution.definitions, incomplete: true }
        : sourceResolution;
    if (resolution.incomplete) unknown ??= call.location;
    for (const target of resolution.definitions) {
      const reached = reachFromCallable(
        module,
        nested,
        target,
        invocationBindings(target, call, new Map(), resolve),
        new Set(),
        state,
        resolve,
      );
      if (reached.status === 'reached') return { status: 'reached', location: call.location };
      if (reached.status === 'unknown') unknown ??= reached.location ?? call.location;
    }
  }
  return unknown === undefined ? { status: 'clear' } : { status: 'unknown', location: unknown };
};
