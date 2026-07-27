import type { WorkspaceInvitation, CreateInvitationInput } from '../workspace.types';
import type { DbExecutor } from '@platform';

export const WORKSPACE_INVITATION_REPOSITORY = Symbol('WORKSPACE_INVITATION_REPOSITORY');

export interface IWorkspaceInvitationRepository {
  findByTokenHash(tokenHash: string): Promise<WorkspaceInvitation | null>;
  findById(id: string): Promise<WorkspaceInvitation | null>;
  findPendingByEmail(workspaceId: string, email: string): Promise<WorkspaceInvitation | null>;
  listByWorkspace(workspaceId: string): Promise<WorkspaceInvitation[]>;
  create(input: CreateInvitationInput, tx?: DbExecutor): Promise<WorkspaceInvitation>;
  updateStatus(id: string, status: string, acceptedBy?: string, tx?: DbExecutor): Promise<void>;
  cancelExistingForEmail(workspaceId: string, email: string, tx?: DbExecutor): Promise<void>;
  /**
   * Re-issue an existing invitation on resend: rotate to a fresh token hash +
   * expiry, force status back to `pending` (revives a lapsed invite), and bump
   * the resend counter / last-sent timestamp. Returns the updated row.
   */
  rotateForResend(
    id: string,
    input: { tokenHash: string; expiresAt: Date; lastSentAt: Date },
    tx?: DbExecutor,
  ): Promise<WorkspaceInvitation>;
}
