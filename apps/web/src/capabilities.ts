/**
 * Capability gating.
 *
 * Every action in this page that needs a local server is declared in the bundle with a reason. A
 * capability the report declares as unavailable is rendered as a disabled control with its reason next
 * to it; a capability the report does not mention at all is not rendered, because a control that
 * cannot work is worse than no control.
 */

import type { ReportCapability } from '@orchescope/schema';

export type CapabilityName = ReportCapability['name'];

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'create_goal',
  'rerun_scenario',
  'run_benchmark',
  'run_chaos',
  'compare_runs',
  'open_source_location',
  'export_standalone',
  'model_interpretation',
];

export interface CapabilityState {
  readonly name: string;
  /** False when the report does not mention the capability at all. */
  readonly declared: boolean;
  readonly available: boolean;
  readonly reason: string;
}

const NOT_DECLARED = 'This report does not offer that action.';

export type CapabilityIndex = ReadonlyMap<string, CapabilityState>;

export function indexCapabilities(capabilities: readonly ReportCapability[]): CapabilityIndex {
  const index = new Map<string, CapabilityState>();
  for (const capability of capabilities) {
    index.set(capability.name, {
      name: capability.name,
      declared: true,
      available: capability.available,
      reason: capability.reason,
    });
  }
  return index;
}

export function capabilityState(index: CapabilityIndex, name: CapabilityName): CapabilityState {
  return index.get(name) ?? { name, declared: false, available: false, reason: NOT_DECLARED };
}

/** Capabilities in the bundle, in the schema's order, followed by anything unrecognised. */
export function orderedCapabilities(index: CapabilityIndex): readonly CapabilityState[] {
  const known = CAPABILITY_NAMES.map((name) => index.get(name)).filter(
    (state): state is CapabilityState => state !== undefined,
  );
  const extra = [...index.values()].filter(
    (state) => !CAPABILITY_NAMES.includes(state.name as CapabilityName),
  );
  return [...known, ...extra];
}
