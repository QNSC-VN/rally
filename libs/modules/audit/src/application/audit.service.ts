import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { JwtPayload, PagedResult } from '@platform';
import {
  AUDIT_REPOSITORY,
  type IAuditRepository,
  type AuditFilters,
} from '../domain/ports/audit.repository';
import type { AuditLog, CreateAuditLogInput } from '../domain/audit.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(AUDIT_REPOSITORY) private readonly auditRepo: IAuditRepository) {}

  /** Called by other services to record an action. Fire-and-forget safe. */
  async record(input: Omit<CreateAuditLogInput, 'id'>): Promise<void> {
    try {
      await this.auditRepo.create({ id: uuidv7(), ...input });
    } catch (err) {
      // Audit must never crash the caller
      this.logger.error({ err, action: input.action }, 'Failed to write audit log');
    }
  }

  async listAuditLogs(
    actor: JwtPayload,
    filters: AuditFilters,
    limit = 50,
    offset = 0,
  ): Promise<PagedResult<AuditLog>> {
    return this.auditRepo.listForTenant(actor.tenantId, filters, { limit, offset });
  }
}
