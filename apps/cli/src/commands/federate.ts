import { writeFileSync } from 'node:fs';
import { formatCount, stableJson } from '@orchescope/domain';
import type {
  FederatedComponentReference,
  FederatedRelation,
  FederationReport,
} from '@orchescope/schema';
import { runFederation } from '@orchescope/usecases';
import { resolveInsideRoot } from '@orchescope/workspace';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit.ts';

export type FederateOptions = {
  readonly repository: readonly string[];
  readonly runs?: string;
  readonly exportJson?: string;
};

const MAX_JSON_ITEMS = 50;
const MAX_TEXT_ITEMS = 10;

const reference = (value: FederatedComponentReference): Record<string, unknown> => ({
  repositoryUrl: value.repository.repositoryUrl,
  revision: value.repository.revision,
  componentId: value.componentId,
});

const relationLine = (relation: FederatedRelation): Record<string, unknown> => ({
  kind: relation.kind,
  from: reference(relation.from),
  to: reference(relation.to),
  executions: relation.observation.executionCount,
  runIds: relation.observation.runIds,
});

const summary = (report: FederationReport, runCount: number): Record<string, unknown> => ({
  federationId: report.federationId,
  runCount,
  repositories: report.repositories.map((repository) => ({
    ...repository.coordinate,
    graphId: repository.graph.graphId,
    components: repository.graph.components.length,
    relations: repository.graph.edges.length,
  })),
  coverage: report.coverage,
  componentJoins: report.componentJoins.slice(0, MAX_JSON_ITEMS).map((join) => ({
    component: reference(join.component),
    observedKind: join.observedKind,
    observedName: join.observedName,
    rule: join.rule,
    runIds: join.runIds,
  })),
  componentJoinsTruncated: report.componentJoins.length > MAX_JSON_ITEMS,
  relations: report.relations.slice(0, MAX_JSON_ITEMS).map(relationLine),
  relationsTruncated: report.relations.length > MAX_JSON_ITEMS,
});

const writeExport = (
  context: CommandContext,
  report: FederationReport,
  relativePath: string | undefined,
): string | undefined => {
  if (relativePath === undefined) return undefined;
  const path = resolveInsideRoot(context.workspace.paths, relativePath);
  writeFileSync(path, `${stableJson(report)}\n`, { mode: 0o600 });
  return context.workspace.redactor.text(relativePath);
};

const repositoryLabel = (repositoryUrl: string): string => {
  const slash = repositoryUrl.lastIndexOf('/');
  return slash < 0 ? repositoryUrl : repositoryUrl.slice(slash + 1);
};

const humanDocument = (
  context: CommandContext,
  report: FederationReport,
  runCount: number,
  written: string | undefined,
): string => {
  const lines = [
    context.style.bold(`Federation ${report.federationId}`),
    `${formatCount(report.repositories.length, 'eligible repository', 'eligible repositories')} scanned separately; ${formatCount(runCount, 'observed run')} considered.`,
    `${formatCount(report.componentJoins.length, 'source-qualified component join')} and ${formatCount(report.relations.length, 'cross-repository relation')}.`,
  ];
  for (const repository of report.repositories) {
    lines.push(
      `  ${repositoryLabel(repository.coordinate.repositoryUrl)} ${repository.coordinate.revision.slice(0, 12)}  ${formatCount(repository.graph.components.length, 'component')}, ${formatCount(repository.graph.edges.length, 'relation')}`,
    );
  }
  if (report.relations.length > 0) {
    lines.push('', context.style.bold('Observed crossings'));
    for (const relation of report.relations.slice(0, MAX_TEXT_ITEMS)) {
      lines.push(
        `  ${repositoryLabel(relation.from.repository.repositoryUrl)}:${relation.from.componentId} ${relation.kind} ${repositoryLabel(relation.to.repository.repositoryUrl)}:${relation.to.componentId}  ${formatCount(relation.observation.executionCount, 'execution')}`,
      );
    }
    if (report.relations.length > MAX_TEXT_ITEMS) {
      lines.push(
        `  ${formatCount(report.relations.length - MAX_TEXT_ITEMS, 'additional crossing')}`,
      );
    }
  }
  if (report.coverage.refusals.length > 0) {
    lines.push('', context.style.bold('Refused evidence'));
    for (const refusal of report.coverage.refusals.slice(0, MAX_TEXT_ITEMS)) {
      lines.push(
        `  ${formatCount(refusal.count, 'input')} ${refusal.scope}: ${refusal.reason}${refusal.attribute === undefined ? '' : ` (${refusal.attribute})`}`,
      );
    }
    if (report.coverage.refusals.length > MAX_TEXT_ITEMS) {
      lines.push(
        `  ${formatCount(report.coverage.refusals.length - MAX_TEXT_ITEMS, 'additional refusal kind')}`,
      );
    }
  }
  if (written !== undefined) lines.push('', `Full report: ${written}`);
  return `${lines.join('\n')}\n`;
};

export const federateCommand = async (
  context: CommandContext,
  options: FederateOptions,
): Promise<number> => {
  const result = await runFederation({
    runtimeWorkspace: context.workspace,
    repositoryRoots: options.repository,
    orchescopeVersion: context.version,
    ...(options.runs === undefined ? {} : { runLimit: Number(options.runs) }),
  });
  const written = writeExport(context, result.report, options.exportJson);
  if (context.json) {
    context.stdout(
      `${stableJson({
        ok: true,
        command: 'federate',
        version: context.version,
        data: { ...summary(result.report, result.runCount), export: written ?? null },
      })}\n`,
    );
  } else {
    context.stdout(humanDocument(context, result.report, result.runCount, written));
  }
  return EXIT_CODES.success;
};
