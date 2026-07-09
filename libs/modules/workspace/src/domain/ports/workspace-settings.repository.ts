import type { WorkspaceSettings, UpdateWorkspaceSettingsInput } from '../workspace.types';

export const WORKSPACE_SETTINGS_REPOSITORY = Symbol('WORKSPACE_SETTINGS_REPOSITORY');

export interface IWorkspaceSettingsRepository {
  findByWorkspace(workspaceId: string): Promise<WorkspaceSettings | null>;
  upsert(
    workspaceId: string,
    input: UpdateWorkspaceSettingsInput,
  ): Promise<WorkspaceSettings>;
}
