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
  /**
   * One page of the log plus `pageInfo.total` — the number of rows matching `filters`
   * across the whole workspace. The total is not optional here: every control on the Audit
   * Log screen filters the real set, and the screen states the set's size (P45-04).
   */
  listForWorkspace(
    workspaceId: string,
    filters: AuditFilters,
    args: { limit: number; offset: number },
  ): Promise<PagedResult<AuditLog>>;
}
