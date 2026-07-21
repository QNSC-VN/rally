import type { StoredFile, CreateFileInput } from '../file.types';

export const FILE_REPOSITORY = Symbol('FILE_REPOSITORY');

/**
 * Every read is workspace-scoped. There is deliberately no `findById(id)`
 * overload without a workspaceId — the previous duplicate implementation in the
 * collaboration module had one, and it was a cross-tenant read waiting for a
 * route. RLS is currently inert (the app connects as table owner and never sets
 * app.workspace_id), so this layer is the only isolation boundary that actually
 * runs.
 */
export interface IFileRepository {
  findById(id: string, workspaceId: string): Promise<StoredFile | null>;

  create(input: CreateFileInput): Promise<StoredFile>;

  /** Mark completed after the object was verified in the bucket. */
  confirm(id: string, checksumSha256: string | null): Promise<StoredFile>;

  softDelete(id: string): Promise<void>;
}
