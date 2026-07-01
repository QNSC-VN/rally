import type { AuditLog, CreateAuditLogInput } from '../audit.types';
import type { PagedResult } from '@platform';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditFilters {
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  projectId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

export interface IAuditRepository {
  /** Idempotent — silently no-ops when sourceEventId already exists. */
  create(input: CreateAuditLogInput): Promise<void>;
  listForTenant(
    tenantId: string,
    filters: AuditFilters,
    args: { limit: number; offset: number },
  ): Promise<PagedResult<AuditLog>>;
}
