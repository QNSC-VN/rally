import { uuidv7 } from 'uuidv7';

/**
 * Generate a UUIDv7 — time-ordered, monotonic, Postgres-native (PG18) friendly.
 * Used for all entity and event IDs.
 */
export function generateId(): string {
  return uuidv7();
}

/**
 * Branded ID types — prevent mixing IDs across entity types at compile time.
 * e.g. WorkItemId cannot be assigned to ProjectId.
 */
declare const __brand: unique symbol;
type Brand<B> = { readonly [__brand]: B };
export type Branded<T, B> = T & Brand<B>;

export type TenantId = Branded<string, 'TenantId'>;
export type WorkspaceId = Branded<string, 'WorkspaceId'>;
export type UserId = Branded<string, 'UserId'>;
export type ProjectId = Branded<string, 'ProjectId'>;
export type WorkItemId = Branded<string, 'WorkItemId'>;
export type SprintId = Branded<string, 'SprintId'>;
export type ReleaseId = Branded<string, 'ReleaseId'>;
export type CommentId = Branded<string, 'CommentId'>;
export type AttachmentId = Branded<string, 'AttachmentId'>;

export function asTenantId(id: string): TenantId {
  return id as TenantId;
}
export function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId;
}
export function asUserId(id: string): UserId {
  return id as UserId;
}
export function asProjectId(id: string): ProjectId {
  return id as ProjectId;
}
export function asWorkItemId(id: string): WorkItemId {
  return id as WorkItemId;
}
