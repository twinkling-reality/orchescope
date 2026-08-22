import type {
  MissingSpanAttribute,
  NormalizedSpan,
  ObservedCodeLocation,
  ObservedSource,
  ObservedValueProvenance,
} from '@orchescope/schema';
import {
  attributeProvenance,
  CODE,
  ORCHESCOPE,
  readNumberAttribute,
  readStringAttribute,
  VCS,
} from './attributes.ts';

export type SourceIdentityResult = {
  readonly codeLocation?: ObservedCodeLocation;
  readonly codeLocationProvenance: ObservedValueProvenance;
  readonly observedSource?: ObservedSource;
  readonly refusals: readonly MissingSpanAttribute[];
};

type ScopedString = {
  readonly value?: string;
  readonly provenance: ObservedValueProvenance;
  readonly conflict: boolean;
};

const scopedString = (span: NormalizedSpan, attribute: string): ScopedString => {
  const spanValue = span.attributes[attribute];
  const resourceValue = span.resourceAttributes?.[attribute];
  const fromSpan = typeof spanValue === 'string' && spanValue.length > 0 ? spanValue : undefined;
  const fromResource =
    typeof resourceValue === 'string' && resourceValue.length > 0 ? resourceValue : undefined;
  const provenance: ObservedValueProvenance = {
    attributes: fromSpan === undefined ? [] : [attribute],
    ...(fromResource === undefined ? {} : { resourceAttributes: [attribute] }),
    spanFields: [],
  };
  if (fromSpan !== undefined && fromResource !== undefined && fromSpan !== fromResource) {
    return { provenance, conflict: true };
  }
  const value = fromSpan ?? fromResource;
  return { ...(value === undefined ? {} : { value }), provenance, conflict: false };
};

const refusal = (
  attribute: string,
  reason: MissingSpanAttribute['reason'],
): MissingSpanAttribute => ({
  attribute,
  purpose: 'source_identity',
  ...(reason === undefined ? {} : { reason }),
  observedComponents: 1,
});

const canonicalRepositoryUrl = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (parsed.username.length > 0 || parsed.password.length > 0) return undefined;
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\.git$/, '').replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    if (parsed.pathname.length <= 1) return undefined;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

const repositoryPath = (value: string): string | undefined => {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.length === 0 || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return undefined;
  }
  return normalized;
};

const absoluteFilePath = (value: string): string | undefined => {
  let candidate = value;
  if (value.startsWith('file:')) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost')) {
        return undefined;
      }
      candidate = decodeURIComponent(parsed.pathname);
      if (/^\/[A-Za-z]:\//.test(candidate)) candidate = candidate.slice(1);
    } catch {
      return undefined;
    }
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return undefined;
  }
  if (candidate.startsWith('<') && candidate.endsWith('>')) return undefined;
  const normalized = candidate.replace(/\\/g, '/');
  if (!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) return undefined;
  return normalized;
};

const pathEndsWith = (absolute: string, relative: string): boolean =>
  absolute === relative || absolute.endsWith(`/${relative}`);

type SourceInputs = {
  readonly rawFile: ReturnType<typeof readStringAttribute>;
  readonly line: ReturnType<typeof readNumberAttribute>;
  readonly functionName: ReturnType<typeof readStringAttribute>;
  readonly relative: ReturnType<typeof readStringAttribute>;
  readonly repository: ScopedString;
  readonly revision: ScopedString;
  readonly codeLocationProvenance: ObservedValueProvenance;
};

const sourceInputsOf = (span: NormalizedSpan): SourceInputs => {
  const rawFile = readStringAttribute(span.attributes, CODE.filePath, CODE.legacyFilePath);
  const line = readNumberAttribute(span.attributes, CODE.lineNumber, CODE.legacyLineNumber);
  const functionName = readStringAttribute(span.attributes, CODE.functionName, CODE.legacyFunction);
  const relative = readStringAttribute(span.attributes, ORCHESCOPE.repositoryPath);
  const repository = scopedString(span, VCS.repositoryUrl);
  const revision = scopedString(span, VCS.headRevision);
  const codeLocationProvenance = attributeProvenance(
    ...(rawFile === undefined ? [] : [rawFile.attribute]),
    ...(relative === undefined ? [] : [relative.attribute]),
    ...(line === undefined ? [] : [line.attribute]),
    ...(functionName === undefined ? [] : [functionName.attribute]),
  );
  return {
    rawFile,
    line,
    functionName,
    relative,
    repository,
    revision,
    codeLocationProvenance,
  };
};

const missingInputRefusals = (inputs: SourceInputs): MissingSpanAttribute[] => {
  const refusals: MissingSpanAttribute[] = [];
  const { rawFile, relative, repository, revision } = inputs;

  if (rawFile === undefined) {
    refusals.push({
      attribute: CODE.filePath,
      purpose: 'code_location',
      reason: 'missing',
      observedComponents: 1,
    });
  }
  if (relative === undefined) refusals.push(refusal(ORCHESCOPE.repositoryPath, 'missing'));
  if (repository.conflict) {
    refusals.push(refusal(VCS.repositoryUrl, 'conflicting_attributes'));
  } else if (repository.value === undefined) {
    refusals.push(refusal(VCS.repositoryUrl, 'missing'));
  }
  if (revision.conflict) {
    refusals.push(refusal(VCS.headRevision, 'conflicting_attributes'));
  } else if (revision.value === undefined) {
    refusals.push(refusal(VCS.headRevision, 'missing'));
  }
  return refusals;
};

const legacyCodeLocation = (
  inputs: SourceInputs,
): {
  readonly codeLocation?: ObservedCodeLocation;
  readonly refusals: readonly MissingSpanAttribute[];
} => {
  const { rawFile, line, functionName } = inputs;
  if (rawFile === undefined || absoluteFilePath(rawFile.value) !== undefined)
    return { refusals: [] };
  const file = repositoryPath(rawFile.value);
  if (file === undefined) {
    return { refusals: [refusal(rawFile.attribute, 'invalid_path')] };
  }
  const validLine =
    line !== undefined && Number.isInteger(line.value) && line.value >= 1 ? line.value : undefined;
  return {
    codeLocation: {
      file,
      ...(validLine === undefined ? {} : { line: validLine }),
      ...(functionName === undefined ? {} : { function: functionName.value }),
    },
    refusals: [],
  };
};

type CompleteSourceInputs = {
  readonly relativeFile: string;
  readonly repositoryUrl: string;
  readonly immutableRevision: string;
  readonly rawFile: NonNullable<SourceInputs['rawFile']>;
  readonly relative: NonNullable<SourceInputs['relative']>;
};

const completeSourceInputs = (
  inputs: SourceInputs,
  refusals: MissingSpanAttribute[],
): CompleteSourceInputs | undefined => {
  const { rawFile, relative, repository, revision } = inputs;

  const relativeFile = relative === undefined ? undefined : repositoryPath(relative.value);
  const absoluteFile = rawFile === undefined ? undefined : absoluteFilePath(rawFile.value);
  const repositoryUrl =
    repository.value === undefined ? undefined : canonicalRepositoryUrl(repository.value);
  const immutableRevision =
    revision.value !== undefined && /^[0-9a-f]{40}$/.test(revision.value)
      ? revision.value
      : undefined;

  if (relative !== undefined && relativeFile === undefined) {
    refusals.push(refusal(relative.attribute, 'invalid_path'));
  }
  if (repository.value !== undefined && repositoryUrl === undefined) {
    refusals.push(refusal(VCS.repositoryUrl, 'invalid_path'));
  }
  if (revision.value !== undefined && immutableRevision === undefined) {
    refusals.push(refusal(VCS.headRevision, 'invalid_path'));
  }
  if (
    rawFile === undefined ||
    relative === undefined ||
    absoluteFile === undefined ||
    relativeFile === undefined ||
    repositoryUrl === undefined ||
    immutableRevision === undefined ||
    !pathEndsWith(absoluteFile, relativeFile)
  ) {
    if (
      absoluteFile !== undefined &&
      relativeFile !== undefined &&
      !pathEndsWith(absoluteFile, relativeFile)
    ) {
      refusals.push(refusal(ORCHESCOPE.repositoryPath, 'invalid_path'));
    }
    return undefined;
  }
  return { relativeFile, repositoryUrl, immutableRevision, rawFile, relative };
};

/** Read and validate one span's independently emitted runtime source coordinate. */
export const sourceIdentityOf = (span: NormalizedSpan): SourceIdentityResult => {
  const inputs = sourceInputsOf(span);
  const refusals = missingInputRefusals(inputs);
  const legacy = legacyCodeLocation(inputs);
  refusals.push(...legacy.refusals);
  if (legacy.codeLocation !== undefined) {
    return {
      codeLocation: legacy.codeLocation,
      codeLocationProvenance: inputs.codeLocationProvenance,
      refusals,
    };
  }
  const complete = completeSourceInputs(inputs, refusals);
  if (complete === undefined) {
    return { codeLocationProvenance: inputs.codeLocationProvenance, refusals };
  }

  const { functionName, line, repository, revision } = inputs;
  const validLine =
    line !== undefined && Number.isInteger(line.value) && line.value >= 1 ? line.value : undefined;
  const codeLocation: ObservedCodeLocation = {
    file: complete.relativeFile,
    ...(validLine === undefined ? {} : { line: validLine }),
    ...(functionName === undefined ? {} : { function: functionName.value }),
  };
  const observedSource: ObservedSource = {
    identity: {
      repositoryUrl: complete.repositoryUrl,
      revision: complete.immutableRevision,
      file: complete.relativeFile,
      ...(validLine === undefined ? {} : { line: validLine }),
      ...(functionName === undefined ? {} : { function: functionName.value }),
    },
    provenance: {
      repositoryUrl: repository.provenance,
      revision: revision.provenance,
      file: attributeProvenance(complete.rawFile.attribute, complete.relative.attribute),
      ...(validLine === undefined
        ? {}
        : { line: attributeProvenance(line?.attribute ?? CODE.lineNumber) }),
      ...(functionName === undefined
        ? {}
        : { function: attributeProvenance(functionName.attribute) }),
    },
  };
  return {
    codeLocation,
    codeLocationProvenance: inputs.codeLocationProvenance,
    observedSource,
    refusals,
  };
};

export const sourceIdentityKey = (source: ObservedSource | undefined): string => {
  if (source === undefined) return 'source:none';
  const identity = source.identity;
  return [
    identity.repositoryUrl,
    identity.revision,
    identity.file,
    identity.line ?? '',
    identity.function ?? '',
  ].join('|');
};
