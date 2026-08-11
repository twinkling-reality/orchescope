import type { Finding, SystemGraph } from '@orchescope/schema';

/**
 * Export formats for agents and CI.
 *
 * Mermaid is a static diagram artifact for pull requests and docs. SARIF 2.1.0 feeds existing code
 * scanning tools. There is no HTML product surface: humans read the terminal, agents read JSON or MCP.
 */

const MERMAID_MAX_EDGES = 400;

const MERMAID_SHAPE: Readonly<Record<string, [string, string]>> = {
  agent: ['[', ']'],
  agent_group: ['[[', ']]'],
  model: ['(', ')'],
  provider: ['((', '))'],
  tool: ['{{', '}}'],
  mcp_server: ['[/', '/]'],
  prompt: ['>', ']'],
  retrieval: ['[(', ')]'],
  memory: ['[(', ')]'],
  database: ['[(', ')]'],
  queue: ['[/', '\\]'],
  external_service: ['{{', '}}'],
  approval_boundary: ['{', '}'],
  side_effect: ['[', ']'],
  entrypoint: ['([', '])'],
  project: ['[', ']'],
};

const mermaidId = (componentId: string): string => componentId.replace(/[^A-Za-z0-9_]/g, '_');

const mermaidLabel = (text: string): string =>
  `"${text
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 60)}"`;

export type MermaidOptions = {
  readonly direction?: 'LR' | 'TB';
  readonly includeRuntimeOnly?: boolean;
  readonly maxEdges?: number;
};

export const toMermaid = (graph: SystemGraph, options: MermaidOptions = {}): string => {
  const direction = options.direction ?? 'LR';
  const maxEdges = options.maxEdges ?? MERMAID_MAX_EDGES;
  const lines = [`flowchart ${direction}`];

  const byKind = new Map<string, typeof graph.components>();
  for (const component of graph.components) {
    const bucket = byKind.get(component.kind);
    if (bucket === undefined) byKind.set(component.kind, [component]);
    else bucket.push(component);
  }

  for (const [kind, components] of [...byKind].sort((left, right) =>
    left[0] < right[0] ? -1 : 1,
  )) {
    lines.push(`  subgraph ${mermaidId(kind)}["${kind.replace(/_/g, ' ')}"]`);
    for (const component of components) {
      const [open, close] = MERMAID_SHAPE[component.kind] ?? ['[', ']'];
      const marker = component.presence.runtime
        ? component.presence.static
          ? ''
          : ' (runtime only)'
        : ' (not exercised)';
      lines.push(
        `    ${mermaidId(component.id)}${open}${mermaidLabel(`${component.displayName}${marker}`)}${close}`,
      );
    }
    lines.push('  end');
  }

  const edges = graph.edges
    .filter((edge) => options.includeRuntimeOnly !== false || !edge.runtimeOnly)
    .filter((edge) => edge.kind !== 'contains')
    .slice(0, maxEdges);
  for (const edge of edges) {
    const arrow = edge.runtimeOnly ? '-.->' : '-->';
    lines.push(
      `  ${mermaidId(edge.from)} ${arrow}|${mermaidLabel(edge.kind.replace(/_/g, ' '))}| ${mermaidId(edge.to)}`,
    );
  }
  if (graph.edges.length > edges.length) {
    lines.push(
      `  %% ${graph.edges.length - edges.length} further relations omitted to stay under the Mermaid edge limit`,
    );
  }
  return `${lines.join('\n')}\n`;
};

const SARIF_LEVEL: Readonly<Record<string, string>> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

export type SarifOptions = {
  readonly toolVersion: string;
  readonly informationUri?: string;
};

export const toSarif = (
  findings: readonly Finding[],
  options: SarifOptions,
): Record<string, unknown> => {
  const risks = findings.filter((finding) => finding.polarity === 'risk');
  const rules = new Map<string, Record<string, unknown>>();
  for (const finding of risks) {
    if (rules.has(finding.ruleId)) continue;
    rules.set(finding.ruleId, {
      id: finding.ruleId,
      name: finding.ruleId,
      shortDescription: { text: finding.title },
      fullDescription: { text: finding.explanation },
      defaultConfiguration: { level: SARIF_LEVEL[finding.severity] ?? 'note' },
      properties: {
        category: finding.category,
        tags: [finding.category, ...finding.taxonomy],
      },
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Orchescope',
            version: options.toolVersion,
            ...(options.informationUri === undefined
              ? {}
              : { informationUri: options.informationUri }),
            rules: [...rules.values()],
          },
        },
        results: risks.map((finding) => ({
          ruleId: finding.ruleId,
          level: SARIF_LEVEL[finding.severity] ?? 'note',
          message: { text: `${finding.title}. ${finding.impact}` },
          locations:
            finding.sourceLocations.length === 0
              ? []
              : finding.sourceLocations.slice(0, 8).map((location) => ({
                  physicalLocation: {
                    artifactLocation: { uri: location.file },
                    region: {
                      startLine: location.startLine,
                      ...(location.startColumn === undefined
                        ? {}
                        : { startColumn: location.startColumn + 1 }),
                    },
                  },
                })),
          partialFingerprints: { orchescopeFindingId: finding.id },
          properties: {
            confidence: finding.confidence,
            basis: finding.basis,
            components: finding.components,
            evidenceCount: finding.evidence.length,
          },
        })),
      },
    ],
  };
};
