import type { TimeLog, CreateTimeLogInput, UpdateTimeLogInput } from '../time-log.types';

export const TIME_LOG_REPOSITORY = Symbol('TIME_LOG_REPOSITORY');

export interface ITimeLogRepository {
  findById(id: string, tenantId: string): Promise<TimeLog | null>;

  listByWorkItem(
    workItemId: string,
    tenantId: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: TimeLog[]; total: number }>;

  create(input: CreateTimeLogInput): Promise<TimeLog>;

  update(id: string, input: UpdateTimeLogInput): Promise<TimeLog>;

  /** Soft-delete. Returns the updated row for verification. */
  softDelete(id: string): Promise<TimeLog>;
}
