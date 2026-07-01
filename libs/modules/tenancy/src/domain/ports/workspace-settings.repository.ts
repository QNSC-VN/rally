import type { WorkspaceSettings, UpdateWorkspaceSettingsInput } from '../tenancy.types';

export const WORKSPACE_SETTINGS_REPOSITORY = Symbol('WORKSPACE_SETTINGS_REPOSITORY');

export interface IWorkspaceSettingsRepository {
  findByWorkspace(workspaceId: string): Promise<WorkspaceSettings | null>;
  upsert(
    workspaceId: string,
    tenantId: string,
    input: UpdateWorkspaceSettingsInput,
  ): Promise<WorkspaceSettings>;
}
