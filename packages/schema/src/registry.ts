import type { TSchema } from '@sinclair/typebox';
import { BenchmarkReport } from './benchmark.ts';
import { ChaosReport } from './chaos.ts';
import { Comparison } from './comparison.ts';
import { OrchescopeConfig } from './config.ts';
import { FindingSet } from './finding.ts';
import { Goal } from './goal.ts';
import { SystemGraph } from './graph.ts';
import { Manifest } from './manifest.ts';
import { ReportBundle } from './report.ts';
import { Scenario } from './scenario.ts';
import { ScenarioResult } from './scenario-result.ts';
import { TraceBundle } from './trace.ts';
import { MIN_READABLE_VERSIONS, SCHEMA_VERSIONS, type SchemaName } from './version.ts';

/**
 * The document registry. It drives JSON Schema emission into `schemas/`, artifact import validation
 * and the schema compatibility check in CI, so a new document type cannot be forgotten in one of them.
 */
export const DOCUMENT_SCHEMAS: Readonly<Record<SchemaName, TSchema>> = {
  systemGraph: SystemGraph,
  finding: FindingSet,
  scenario: Scenario,
  scenarioResult: ScenarioResult,
  benchmark: BenchmarkReport,
  chaos: ChaosReport,
  comparison: Comparison,
  goal: Goal,
  report: ReportBundle,
  traceBundle: TraceBundle,
  manifest: Manifest,
  config: OrchescopeConfig,
};

export type DocumentDescriptor = {
  readonly name: SchemaName;
  readonly schema: TSchema;
  readonly version: number;
  readonly minReadableVersion: number;
  readonly fileName: string;
};

export const documentDescriptors = (): readonly DocumentDescriptor[] =>
  (Object.keys(DOCUMENT_SCHEMAS) as SchemaName[]).map((name) => ({
    name,
    schema: DOCUMENT_SCHEMAS[name],
    version: SCHEMA_VERSIONS[name],
    minReadableVersion: MIN_READABLE_VERSIONS[name],
    fileName: `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.v${SCHEMA_VERSIONS[name]}.json`,
  }));
