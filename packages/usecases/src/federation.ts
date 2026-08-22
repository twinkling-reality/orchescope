import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { OrchescopeError, runIsSilent } from '@orchescope/domain';
import { federate } from '@orchescope/graph';
import { redactDeep } from '@orchescope/redaction';
import type { Evidence, FederationReport, RuntimeTopology } from '@orchescope/schema';
import { deriveTopology } from '@orchescope/traces';
import { openWorkspace, type Workspace } from '@orchescope/workspace';
import { runAudit } from './audit.ts';

const MAX_REPOSITORIES = 8;
const MAX_RUNS = 50;

export type FederationRequest = {
  /** Workspace that owns the stored multi-process run. */
  readonly runtimeWorkspace: Workspace;
  /** Operator-supplied roots to scan, never treated as observed repository identity. */
  readonly repositoryRoots: readonly string[];
  readonly orchescopeVersion: string;
  readonly runLimit?: number;
};

export type FederationResult = {
  readonly report: FederationReport;
  readonly runCount: number;
};

const repositoryRoot = (runtimeRoot: string, supplied: string): string => {
  if (supplied.length === 0) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'A repository path cannot be empty.');
  }
  let canonical: string;
  try {
    canonical = realpathSync(resolve(runtimeRoot, supplied));
  } catch {
    throw new OrchescopeError('NOT_FOUND', `Repository path does not exist: ${supplied}.`);
  }
  if (!statSync(canonical).isDirectory()) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `Repository path is not a directory: ${supplied}.`,
    );
  }
  return canonical;
};

const validatedRoots = (request: FederationRequest): readonly string[] => {
  if (request.repositoryRoots.length < 2 || request.repositoryRoots.length > MAX_REPOSITORIES) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `Federation needs between 2 and ${MAX_REPOSITORIES} repository roots.`,
    );
  }
  const roots = request.repositoryRoots.map((root) =>
    repositoryRoot(request.runtimeWorkspace.paths.root, root),
  );
  if (new Set(roots).size !== roots.length) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'Each federated repository root must be distinct.',
    );
  }
  return roots;
};

const validatedRunLimit = (value: number | undefined): number => {
  const limit = value ?? 10;
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_RUNS) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `The run limit must be an integer from 0 through ${MAX_RUNS}.`,
    );
  }
  return limit;
};

const openRepository = (
  runtimeWorkspace: Workspace,
  root: string,
): { readonly workspace: Workspace; readonly owned: boolean } => {
  if (root === runtimeWorkspace.paths.root) {
    return { workspace: runtimeWorkspace, owned: false };
  }
  return {
    workspace: openWorkspace({
      root,
      clock: runtimeWorkspace.clock,
      progress: runtimeWorkspace.progress,
      logLevel: 'warning',
    }),
    owned: true,
  };
};

const runtimeTopologies = (
  workspace: Workspace,
  limit: number,
): {
  readonly topologies: readonly RuntimeTopology[];
  readonly evidence: readonly Evidence[];
} => {
  const topologies: RuntimeTopology[] = [];
  const evidence: Evidence[] = [];
  for (const summary of workspace.store.listRuns({ projectId: workspace.projectId, limit })) {
    const bundle = workspace.store.traceForRun(summary.runId);
    if (bundle === undefined || runIsSilent(bundle.spans.length)) continue;
    const derived = deriveTopology(bundle);
    topologies.push(derived.topology);
    evidence.push(...derived.evidence);
  }
  return { topologies, evidence };
};

/** Scans each supplied repository separately and federates only what stored runtime evidence qualifies. */
export const runFederation = async (request: FederationRequest): Promise<FederationResult> => {
  const roots = validatedRoots(request);
  const runLimit = validatedRunLimit(request.runLimit);
  const opened: { readonly workspace: Workspace; readonly owned: boolean }[] = [];
  try {
    const repositories = [];
    for (const root of roots) {
      const entry = openRepository(request.runtimeWorkspace, root);
      opened.push(entry);
      const audit = await runAudit({
        workspace: entry.workspace,
        orchescopeVersion: request.orchescopeVersion,
        runLimit: 0,
      });
      repositories.push({ graph: audit.graph, evidence: audit.bundle.evidence });
    }

    const runtime = runtimeTopologies(request.runtimeWorkspace, runLimit);
    const report = federate({
      repositories,
      topologies: runtime.topologies,
      runtimeEvidence: runtime.evidence,
      orchescopeVersion: request.orchescopeVersion,
      generatedAt: request.runtimeWorkspace.clock.now(),
    });
    return {
      report: redactDeep(report, request.runtimeWorkspace.redactor),
      runCount: runtime.topologies.length,
    };
  } finally {
    for (const entry of opened.reverse()) {
      if (entry.owned) entry.workspace.close();
    }
  }
};
