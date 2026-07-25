import type { RequestContext } from '../context.ts';
import type { FaultDecision, FaultKind } from '../faults.ts';
import {
  ATTR,
  type CodeSite,
  SPAN_KIND_INTERNAL,
  type Span,
  type SpanAttributes,
} from '../telemetry.ts';

/**
 * The two things every tool in this system does the same way: it reports itself with the tool attributes
 * Orchescope reads, and it asks the fault engine whether this attempt is the one that fails.
 */

/** Tools answer immediately, so a tool that exceeds this deadline is a tool a fault is holding. */
export const TOOL_DEADLINE_MS = 50;

const TOOL_FAULTS: readonly FaultKind[] = [
  'tool_timeout',
  'tool_exception',
  'tool_malformed_result',
];

export type ToolSpanOptions = {
  readonly toolName: string;
  readonly site: CodeSite;
  readonly attributes?: SpanAttributes;
};

export const runTool = <T>(
  context: RequestContext,
  parent: Span,
  options: ToolSpanOptions,
  body: (span: Span) => Promise<T>,
): Promise<T> =>
  context.trace.run(
    {
      name: `execute_tool ${options.toolName}`,
      kind: SPAN_KIND_INTERNAL,
      site: options.site,
      attributes: {
        [ATTR.operationName]: 'execute_tool',
        [ATTR.toolName]: options.toolName,
        [ATTR.toolType]: 'function',
        [ATTR.conversationId]: context.conversationId,
        ...options.attributes,
      },
    },
    parent,
    body,
  );

export const toolFault = (
  context: RequestContext,
  toolName: string,
  attempt: number,
): FaultDecision | undefined => {
  for (const kind of TOOL_FAULTS) {
    const decision = context.faults.decide(kind, toolName, attempt);
    if (decision !== undefined) return decision;
  }
  return undefined;
};
