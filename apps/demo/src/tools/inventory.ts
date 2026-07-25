import { type InventoryRecord, noteFault, type RequestContext } from '../context.ts';
import { DemoFailure, sleep, sleepBounded, withDeadline } from '../failures.ts';
import type { FaultDecision } from '../faults.ts';
import { indexOf } from '../random.ts';
import { type Span, sourceFile } from '../telemetry.ts';
import { runTool, TOOL_DEADLINE_MS, toolFault } from './tool-span.ts';

/** A read only stock lookup. Independent of `lookup_account`, and called after it anyway: see issue 1. */

const site = sourceFile('apps/demo/src/tools/inventory.ts');

export const CHECK_INVENTORY = 'check_inventory';

const WAREHOUSES: readonly string[] = ['ams-1', 'sfo-2', 'sin-3'];

const inventoryFor = (orderId: string): InventoryRecord => ({
  sku: `sku-${900 + indexOf(90, 'sku', orderId)}`,
  orderId,
  onHand: indexOf(12, 'stock', orderId),
  restockDays: 1 + indexOf(9, 'restock', orderId),
  warehouse: WAREHOUSES[indexOf(WAREHOUSES.length, 'warehouse', orderId)] ?? 'ams-1',
  complete: true,
});

const readInventory = async (
  orderId: string,
  fault: FaultDecision | undefined,
): Promise<InventoryRecord> => {
  if (fault?.kind === 'tool_timeout') {
    await sleepBounded(Math.max(fault.delayMs, TOOL_DEADLINE_MS * 2));
  } else if (fault?.kind === 'tool_exception') {
    throw new DemoFailure('failed', `${CHECK_INVENTORY} failed at the warehouse service`);
  } else {
    await sleep(0);
  }
  const record = inventoryFor(orderId);
  return fault?.kind === 'tool_malformed_result'
    ? { ...record, onHand: -1, restockDays: -1, complete: false }
    : record;
};

export const checkInventory = (
  context: RequestContext,
  parent: Span,
  orderId: string,
): Promise<InventoryRecord> =>
  runTool(
    context,
    parent,
    { toolName: CHECK_INVENTORY, site: site('checkInventory', 50) },
    async (span) => {
      const fault = toolFault(context, CHECK_INVENTORY, 1);
      if (fault !== undefined) noteFault(span, fault);
      return await withDeadline(
        readInventory(orderId, fault),
        TOOL_DEADLINE_MS,
        `${CHECK_INVENTORY} exceeded its ${TOOL_DEADLINE_MS}ms deadline`,
      );
    },
  );
