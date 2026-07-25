import { OrchescopeError } from '@orchescope/domain';
import type { Evidence, SystemGraph } from '@orchescope/schema';
import type { ArtifactStore } from '../artifacts.ts';
import { asBoolean, asInteger, asNullable, type Database } from '../database.ts';
import type { ScanSummary } from '../rows.ts';
import { integer, optionalText, text } from '../rows.ts';
import type { ProjectsRepository } from './projects.ts';

/**
 * Scans and graphs.
 *
 * The graph goes to the artifact store and the row keeps the counts worth querying, so listing scans does not read
 * every graph.
 */

export const createScansRepository = (input: {
  readonly database: Database;
  readonly artifacts: ArtifactStore;
  /** A scan row references a project row and its evidence is written in the same transaction. */
  readonly projects: ProjectsRepository;
}) => {
  const { database, artifacts, projects } = input;

  const saveScan = (graph: SystemGraph, evidence: readonly Evidence[]): ScanSummary =>
    database.transaction(() => {
      projects.ensureProject(
        graph.provenance.projectId,
        graph.provenance.projectName,
        graph.provenance.projectPathHash,
      );
      const digest = artifacts.putJson(graph);
      database.run(
        `INSERT INTO scan (id, project_id, graph_id, graph_digest, created_at, component_count, edge_count,
                           git_commit, git_ref, git_dirty, orchescope_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET graph_digest = excluded.graph_digest,
                                       component_count = excluded.component_count,
                                       edge_count = excluded.edge_count`,
        graph.provenance.scanId,
        graph.provenance.projectId,
        graph.graphId,
        digest,
        graph.provenance.generatedAt,
        graph.components.length,
        graph.edges.length,
        asNullable(graph.provenance.git?.commit),
        asNullable(graph.provenance.git?.ref),
        asInteger(graph.provenance.git?.dirty ?? false),
        graph.provenance.orchescopeVersion,
      );
      database.run('DELETE FROM component WHERE scan_id = ?', graph.provenance.scanId);
      database.run('DELETE FROM edge WHERE scan_id = ?', graph.provenance.scanId);
      for (const component of graph.components) {
        database.run(
          `INSERT INTO component (scan_id, id, kind, display_name, fingerprint, namespace, local_name,
                                  present_static, present_runtime, present_manifest, basis, confidence,
                                  side_effect, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          graph.provenance.scanId,
          component.id,
          component.kind,
          component.displayName,
          component.fingerprint,
          component.identity.namespace,
          component.identity.localName,
          asInteger(component.presence.static),
          asInteger(component.presence.runtime),
          asInteger(component.presence.manifest),
          component.basis,
          component.confidence,
          asNullable(component.sideEffect),
          JSON.stringify(component),
        );
      }
      for (const edge of graph.edges) {
        database.run(
          `INSERT INTO edge (scan_id, id, kind, from_id, to_id, runtime_only, basis, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          graph.provenance.scanId,
          edge.id,
          edge.kind,
          edge.from,
          edge.to,
          asInteger(edge.runtimeOnly),
          edge.basis,
          JSON.stringify(edge),
        );
      }
      projects.saveEvidence(evidence);
      return {
        scanId: graph.provenance.scanId,
        graphId: graph.graphId,
        createdAt: graph.provenance.generatedAt,
        componentCount: graph.components.length,
        edgeCount: graph.edges.length,
        gitCommit: graph.provenance.git?.commit,
        gitRef: graph.provenance.git?.ref,
        gitDirty: graph.provenance.git?.dirty ?? false,
        digest,
      };
    });

  const scanSummary = (row: Record<string, unknown>): ScanSummary => ({
    scanId: text(row, 'id'),
    graphId: text(row, 'graph_id'),
    createdAt: text(row, 'created_at'),
    componentCount: integer(row, 'component_count'),
    edgeCount: integer(row, 'edge_count'),
    gitCommit: optionalText(row, 'git_commit'),
    gitRef: optionalText(row, 'git_ref'),
    gitDirty: asBoolean(row['git_dirty']),
    digest: text(row, 'graph_digest'),
  });

  const latestScan = (projectId: string): ScanSummary | undefined => {
    const row = database.get(
      'SELECT * FROM scan WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      projectId,
    );
    return row === undefined ? undefined : scanSummary(row);
  };

  const scanById = (scanId: string): ScanSummary | undefined => {
    const row = database.get('SELECT * FROM scan WHERE id = ?', scanId);
    return row === undefined ? undefined : scanSummary(row);
  };

  const graphForScan = (scanId: string): SystemGraph => {
    const summary = scanById(scanId);
    if (summary === undefined) {
      throw new OrchescopeError('NOT_FOUND', `No scan with identifier ${scanId}.`);
    }
    return artifacts.getJson<SystemGraph>(summary.digest);
  };

  return {
    saveScan,
    latestScan,
    scanById,
    graphForScan,
  };
};
