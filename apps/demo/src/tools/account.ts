import { type AccountRecord, noteFault, type RequestContext } from '../context.ts';
import { DemoFailure, sleep, sleepBounded, withDeadline } from '../failures.ts';
import type { FaultDecision } from '../faults.ts';
import { indexOf } from '../random.ts';
import { type Span, sourceFile } from '../telemetry.ts';
import { runTool, TOOL_DEADLINE_MS, toolFault } from './tool-span.ts';

/** A read only account lookup against a fixed customer table. */

const site = sourceFile('apps/demo/src/tools/account.ts');

export const LOOKUP_ACCOUNT = 'lookup_account';

const ACCOUNTS: readonly AccountRecord[] = [
  {
    accountId: 'acct_4417',
    orderId: '1234',
    holder: 'Ines Okoro',
    tier: 'standard',
    refundAmount: 129.99,
    currency: 'USD',
    openTickets: 1,
    complete: true,
  },
  {
    accountId: 'acct_8802',
    orderId: '5678',
    holder: 'Marek Duval',
    tier: 'business',
    refundAmount: 640.5,
    currency: 'EUR',
    openTickets: 0,
    complete: true,
  },
  {
    accountId: 'acct_9153',
    orderId: '9001',
    holder: 'Priya Raman',
    tier: 'enterprise',
    refundAmount: 7400,
    currency: 'USD',
    openTickets: 3,
    complete: true,
  },
];

const syntheticAccount = (orderId: string): AccountRecord => ({
  accountId: `acct_${1000 + indexOf(9000, 'account', orderId)}`,
  orderId,
  holder: 'Unnamed Customer',
  tier: 'standard',
  refundAmount: 25 + indexOf(200, 'amount', orderId),
  currency: 'USD',
  openTickets: indexOf(3, 'tickets', orderId),
  complete: true,
});

const readAccount = async (
  orderId: string,
  fault: FaultDecision | undefined,
): Promise<AccountRecord> => {
  if (fault?.kind === 'tool_timeout') {
    await sleepBounded(Math.max(fault.delayMs, TOOL_DEADLINE_MS * 2));
  } else if (fault?.kind === 'tool_exception') {
    throw new DemoFailure('failed', `${LOOKUP_ACCOUNT} failed at the account service`);
  } else {
    await sleep(0);
  }
  const record = ACCOUNTS.find((entry) => entry.orderId === orderId) ?? syntheticAccount(orderId);
  // A malformed answer keeps the shape and loses the fields the caller needs, which is the realistic form
  // of this fault and the one a caller can actually detect.
  return fault?.kind === 'tool_malformed_result'
    ? { ...record, refundAmount: 0, currency: '', complete: false }
    : record;
};

export const lookupAccount = (
  context: RequestContext,
  parent: Span,
  orderId: string,
): Promise<AccountRecord> =>
  runTool(
    context,
    parent,
    { toolName: LOOKUP_ACCOUNT, site: site('lookupAccount', 85) },
    async (span) => {
      const fault = toolFault(context, LOOKUP_ACCOUNT, 1);
      if (fault !== undefined) noteFault(span, fault);
      return await withDeadline(
        readAccount(orderId, fault),
        TOOL_DEADLINE_MS,
        `${LOOKUP_ACCOUNT} exceeded its ${TOOL_DEADLINE_MS}ms deadline`,
      );
    },
  );
