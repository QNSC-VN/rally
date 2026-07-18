import { Injectable } from '@nestjs/common';
import type { DrizzleTx } from '../database/drizzle.provider';
import { OutboxService } from '../outbox/outbox.service';
import { AuditEvent, type AuditEventInput } from './audit-event';

/**
 * AuditProducer — the single, DRY entry point every command handler uses to
 * record an administrative action.
 *
 * It writes an {@link AuditEvent} to the transactional outbox within the
 * caller's transaction; the worker relay then publishes it (SNS → SQS) to the
 * `AuditConsumer`, which persists an `audit.audit_logs` row. Because the write
 * shares the mutation's transaction, the audit trail is atomic with the change.
 *
 * Usage (inside a UnitOfWork transaction):
 *   await this.uow.run(async (tx) => {
 *     const updated = await this.repo.update(id, input, tx);
 *     await this.audit.emit(
 *       {
 *         action: AUDIT_ACTION.WORKSPACE_UPDATED,
 *         resourceType: AUDIT_RESOURCE.WORKSPACE,
 *         resourceId: id,
 *         workspaceId,
 *         actor: { id: actorId },
 *         changes: { before, after: updated },
 *       },
 *       tx,
 *     );
 *     return updated;
 *   });
 */
@Injectable()
export class AuditProducer {
  constructor(private readonly outbox: OutboxService) {}

  /** Emit a single audit event into the outbox within the given transaction. */
  emit(input: AuditEventInput, tx: DrizzleTx): Promise<void> {
    return this.outbox.writeEvents([new AuditEvent(input)], tx);
  }
}
