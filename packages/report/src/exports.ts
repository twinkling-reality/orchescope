import { sha256Hex } from '@orchescope/domain';
import type { Finding, ReportBundle, SystemGraph } from '@orchescope/schema';

/**
 * Export formats.
 *
 * Mermaid is an export, never the interactive view: its documented defaults cap a diagram at 500 edges and
 * 50,000 characters, and its renderer injects an inline style element with no nonce, which a strict content
 * security policy blocks. Diagrams are therefore sliced and the browser never runs Mermaid.
 *
 * SARIF 2.1.0 is emitted so findings flow into existing code scanning tools rather than only into this report.
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

export type StandaloneAssets = {
  readonly javascript: string;
  readonly css: string;
  readonly title: string;
};

const escapeForScriptTag = (json: string): string =>
  // A JSON island inside a script element must not contain a sequence that can close the element early.
  json.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

/**
 * Renders a single file report.
 *
 * The inline script and style are pinned by their own SHA-256 hashes in a meta content security policy, so the
 * file executes exactly what was built and nothing else. `default-src 'none'` means the page cannot reach the
 * network at all, which is what makes a standalone export safe to send to someone else.
 *
 * `font-src data:` rather than `'self'`, and the difference matters only here. This file has no origin worth
 * the name: opened from a disk it is a `file:` page, where `'self'` resolves to nothing it can fetch, so a
 * self hosted face is unreachable and the export would silently fall back to whatever the reader's machine
 * happens to have. The design carries meaning in the type, so that is a different document rather than a
 * plainer one. The widening cannot be abused: `default-src 'none'` still blocks every network destination, the
 * only `data:` scheme allowed is the font one, and a font is not executable. The served report keeps
 * `font-src 'self'` and serves the same two faces as real files.
 */
export const renderStandaloneHtml = (bundle: ReportBundle, assets: StandaloneAssets): string => {
  const data = escapeForScriptTag(JSON.stringify(bundle));
  const scriptHash = sha256Base64(assets.javascript);
  const styleHash = sha256Base64(assets.css);
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    "img-src 'self' data:",
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="referrer" content="no-referrer">
<title>${assets.title.replace(/[<>&]/g, '')}</title>
<style>${assets.css}</style>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="orchescope-report">${data}</script>
<script type="module">${assets.javascript}</script>
</body>
</html>
`;
};

const sha256Base64 = (content: string): string =>
  Buffer.from(sha256Hex(content), 'hex').toString('base64');
