import type { TSchema } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

/**
 * Tool definitions for the agent facing interface.
 *
 * Three rules shape every definition here:
 *
 *  - output is bounded. A tool returns counts, identifiers and a small page of items, never a whole report, because
 *    an agent that receives fifty thousand tokens of graph has less room to do the work than before it asked.
 *  - read and effectful operations are separated and annotated. `readOnlyHint` is true only for tools that cannot
 *    change anything, and every tool that executes the audited system is annotated as not read only.
 *  - schemas are the same TypeBox definitions used everywhere else, emitted as JSON Schema, so the contract an
 *    agent sees is the contract the implementation validates against.
 */

export type ToolAnnotations = {
  readonly title: string;
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
};

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly input: TSchema;
  readonly annotations: ToolAnnotations;
  /** True when the tool executes the audited system, which requires policy to allow process execution. */
  readonly executes: boolean;
};

const readOnly = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const effectful = (title: string, idempotent: boolean): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: idempotent,
  openWorldHint: false,
});

const Empty = Type.Object({}, { additionalProperties: false });

const Page = {
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
};

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'scan_agent_system',
    description:
      'Analyse the repository statically and return what was discovered: component and edge counts by kind, adapter coverage, and what could not be inspected. Does not execute anything and does not need credentials.',
    input: Type.Object(
      { runLimit: Type.Optional(Type.Integer({ minimum: 0, maximum: 50 })) },
      { additionalProperties: false },
    ),
    annotations: readOnly('Scan the agent system'),
    executes: false,
  },
  {
    name: 'audit_agent_system',
    description:
      'Run a full audit: static discovery, reconciliation against stored runs, and the deterministic finding rules. Returns the reconciliation delta, a bounded page of findings, where the repository stands in the five step loop, the one next action (CLI argv and MCP tool when one exists), and which capabilities the current policy allows.',
    input: Type.Object(
      {
        runLimit: Type.Optional(Type.Integer({ minimum: 0, maximum: 50 })),
        maxFindings: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      },
      { additionalProperties: false },
    ),
    annotations: readOnly('Audit the agent system'),
    executes: false,
  },
  {
    name: 'get_system_map',
    description:
      'Return components and edges from the latest scan, filtered by kind and paginated. Use this to look at a part of the graph rather than all of it.',
    input: Type.Object(
      {
        kinds: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
        includeEdges: Type.Optional(Type.Boolean()),
        onlyUnexercised: Type.Optional(Type.Boolean()),
        onlyUndeclared: Type.Optional(Type.Boolean()),
        ...Page,
      },
      { additionalProperties: false },
    ),
    annotations: readOnly('Get the system map'),
    executes: false,
  },
  {
    name: 'get_reconciliation_delta',
    description:
      'Return the delta between what the repository declares and what the observed runs exercised: never exercised, never declared, contradicted declarations and duplicated side effects.',
    input: Empty,
    annotations: readOnly('Get the declared against exercised delta'),
    executes: false,
  },
  {
    name: 'get_findings',
    description:
      'List findings from the latest audit, filtered by severity, category, polarity or affected component. Returns one line per finding; use get_finding for the full record.',
    input: Type.Object(
      {
        severity: Type.Optional(Type.Array(Type.String(), { maxItems: 5 })),
        category: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
        polarity: Type.Optional(Type.Union([Type.Literal('risk'), Type.Literal('strength')])),
        componentId: Type.Optional(Type.String({ maxLength: 200 })),
        goalEligibleOnly: Type.Optional(Type.Boolean()),
        ...Page,
      },
      { additionalProperties: false },
    ),
    annotations: readOnly('Get findings'),
    executes: false,
  },
  {
    name: 'get_finding',
    description:
      'Return one finding in full, with its evidence records, metrics, recommendation and suggested experiment.',
    input: Type.Object(
      { findingId: Type.String({ maxLength: 40 }) },
      { additionalProperties: false },
    ),
    annotations: readOnly('Get one finding'),
    executes: false,
  },
  {
    name: 'create_improvement_goal',
    description:
      'Convert an eligible finding into a bounded improvement goal and return it together with a plain text prompt suitable for handing to a coding agent. Writes the goal to the local store. Calling this twice for one finding returns the goal that already exists rather than a second copy of it; pass createAnother to cut another one deliberately.',
    input: Type.Object(
      {
        findingId: Type.String({ maxLength: 40 }),
        repetitions: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        createAnother: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Create an improvement goal', true),
    executes: false,
  },
  {
    name: 'get_improvement_goal',
    description:
      'Return a stored goal, its acceptance criteria, its validation plan and its agent prompt.',
    input: Type.Object({ goalId: Type.String({ maxLength: 40 }) }, { additionalProperties: false }),
    annotations: readOnly('Get an improvement goal'),
    executes: false,
  },
  {
    name: 'list_scenarios',
    description:
      'List the scenarios defined in this repository, with the permissions each one requires.',
    input: Empty,
    annotations: readOnly('List scenarios'),
    executes: false,
  },
  {
    name: 'import_trace',
    description:
      'Import OpenTelemetry spans from a file inside the repository (OTLP JSON or newline delimited spans) and store them as a run. Does not execute the audited system. Returns the run identifier and span counts, never the spans themselves.',
    input: Type.Object(
      {
        path: Type.String({ minLength: 1, maxLength: 300 }),
        label: Type.Optional(Type.String({ maxLength: 120 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Import a trace', true),
    executes: false,
  },
  {
    name: 'run_traced',
    description:
      'Run a command as an argument array under a loopback OpenTelemetry receiver and store the spans as a run. Returns the run identifier, span count and exit code. Requires policy.allowProcessSpawn and an allowedCommands entry, which checks argv[0] only and is a guardrail rather than a boundary: the command runs with full ambient privileges and is not sandboxed. Pass the real argv that starts the system; never a shell string. When audit names this tool without a command, supply the argv yourself.',
    input: Type.Object(
      {
        command: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
            minItems: 1,
            maxItems: 64,
          }),
        ),
        label: Type.Optional(Type.String({ maxLength: 120 })),
        timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 3_600_000 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Run a traced command', false),
    executes: true,
  },
  {
    name: 'run_scenario',
    description:
      'Execute one scenario and return its result: task success, evaluator outcomes, reliability and the run identifiers. Runs the audited system, so it requires the project policy to allow process execution.',
    input: Type.Object(
      {
        scenarioId: Type.String({ maxLength: 200 }),
        repetitions: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Run a scenario', false),
    executes: true,
  },
  {
    name: 'benchmark_variants',
    description:
      'Vary one named dimension of a scenario and return the per variant distributions with their sample sizes and limitations. One dimension per call, because varying two produces a number that cannot be attributed to either.',
    input: Type.Object(
      {
        scenarioId: Type.String({ maxLength: 200 }),
        dimension: Type.Union([
          Type.Literal('agent_count'),
          Type.Literal('worker_count'),
          Type.Literal('traffic_concurrency'),
        ]),
        values: Type.Array(Type.Integer({ minimum: 1, maximum: 200 }), {
          minItems: 2,
          maxItems: 8,
        }),
        repetitions: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Benchmark variants', false),
    executes: true,
  },
  {
    name: 'inject_faults',
    description:
      'Run the fault plan declared by a scenario and return what each fault did to task completion, recovery, cost and side effects. Defaults to the local deterministic environment.',
    input: Type.Object(
      {
        scenarioId: Type.String({ maxLength: 200 }),
        seed: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 ** 31 })),
        repetitions: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Inject faults', false),
    executes: true,
  },
  {
    name: 'compare_runs',
    description:
      'Compare a baseline against a candidate. Each side may be a run identifier, "latest", a scan identifier or a git revision. Returns per metric deltas with sample sizes and a verdict that refuses to call a latency win an improvement when task success fell.',
    input: Type.Object(
      {
        baseline: Type.String({ maxLength: 200 }),
        candidate: Type.String({ maxLength: 200 }),
        goalId: Type.Optional(Type.String({ maxLength: 40 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Compare runs', true),
    executes: false,
  },
  {
    name: 'validate_improvement_goal',
    description:
      'Judge a goal against its acceptance criteria using a comparison and the stored scenario results. A criterion the evidence cannot decide is reported as undecided rather than as satisfied.',
    input: Type.Object(
      {
        goalId: Type.String({ maxLength: 40 }),
        comparisonId: Type.Optional(Type.String({ maxLength: 40 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Validate an improvement goal', true),
    executes: false,
  },
  {
    name: 'export_report',
    description:
      'Write the latest report to a file inside the repository in json, mermaid, sarif or html, and return the path. Returns a path rather than the content so a large report never enters the conversation.',
    input: Type.Object(
      {
        format: Type.Union([
          Type.Literal('json'),
          Type.Literal('mermaid'),
          Type.Literal('sarif'),
          Type.Literal('html'),
        ]),
        path: Type.Optional(Type.String({ maxLength: 300 })),
      },
      { additionalProperties: false },
    ),
    annotations: effectful('Export the report', true),
    executes: false,
  },
];

export const toolByName = (name: string): ToolDefinition | undefined =>
  TOOL_DEFINITIONS.find((tool) => tool.name === name);
