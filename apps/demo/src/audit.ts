import { DatabaseSync } from 'node:sqlite';
import { type EffectOutcome, type RequestContext, recordEffect } from './context.ts';
import { sleep } from './failures.ts';
import { ATTR, SPAN_KIND_INTERNAL, type Span, sourceFile } from './telemetry.ts';

/**
 * The audit log.
 *
 * INTENTIONAL ISSUE 6: this component is real, it writes to a datastore and it emits a side effect, yet no
 * agent definition mentions it. Static discovery finds a datastore write in this helper while the runtime
 * trace shows the effect under the orchestrator, so the declared architecture and the observed one differ.
 */

const site = sourceFile('apps/demo/src/audit.ts');
const COMPONENT = 'audit-log';
const TARGET = 'sqlite/audit_log';

let database: DatabaseSync | undefined;

const connect = (): DatabaseSync => {
  if (database === undefined) {
    const opened = new DatabaseSync(':memory:');
    opened.exec(
      'create table if not exists audit_log (conversation_id text, action text, subject text, outcome text)',
    );
    database = opened;
  }
  return database;
};

export type AuditEntry = {
  readonly action: string;
  readonly subject: string;
  readonly outcome: EffectOutcome;
};

export const recordAudit = (
  context: RequestContext,
  parent: Span,
  entry: AuditEntry,
): Promise<void> =>
  context.trace.run(
    {
      name: `side_effect ${COMPONENT}`,
      kind: SPAN_KIND_INTERNAL,
      site: site('recordAudit', 46),
      attributes: {
        [ATTR.component]: COMPONENT,
        [ATTR.conversationId]: context.conversationId,
      },
    },
    parent,
    async (span) => {
      connect()
        .prepare(
          'insert into audit_log (conversation_id, action, subject, outcome) values (?, ?, ?, ?)',
        )
        .run(context.conversationId, entry.action, entry.subject, entry.outcome);
      recordEffect(context, span, { kind: 'audit_log', target: TARGET, outcome: 'succeeded' });
      await sleep(0);
    },
  );
