import type { RequestContext } from '../context.ts';
import { sleep } from '../failures.ts';
import { ATTR, type Span, sourceFile } from '../telemetry.ts';
import { runTool } from './tool-span.ts';

/**
 * INTENTIONAL ISSUE 10: a tool that exists only at runtime.
 *
 * The name is assembled from configuration rather than written down, so no parser can see it and it appears in no
 * manifest. Every run reports it, which is exactly the shape Orchescope calls "exercised and never declared": a real
 * operation reaching a real dependency that no reading of the repository would find.
 *
 * This is not contrived. A registry of tools keyed by tenant, a plugin loaded by name, or a capability selected from an
 * environment variable all produce it, and each is a case where the map a team believes they have is missing an edge.
 */

const site = sourceFile('apps/demo/src/tools/metering.ts');

/** The parts are joined at runtime, so the whole name never appears as a literal anywhere. */
const NAME_PARTS = ['record', 'usage'] as const;
const SERVICE_PREFIX = 'metering';

export const meteredToolName = (): string => `${SERVICE_PREFIX}_${NAME_PARTS.join('_')}`;

export const recordUsage = (
  context: RequestContext,
  parent: Span,
  units: number,
): Promise<{ readonly accepted: boolean }> =>
  runTool(
    context,
    parent,
    {
      toolName: meteredToolName(),
      site: site('recordUsage', 28),
      attributes: { [ATTR.toolType]: 'function', 'demo.usage.units': units },
    },
    async () => {
      await sleep(0);
      return { accepted: units >= 0 };
    },
  );
