import type {
  WorkspaceInvitation,
  CreateInvitationInput,
  InvitationProjectAccess,
} from '../workspace.types';
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

  /**
   * Record the per-Project access an invitation carries (§6.4, migration 0119).
   *
   * Written inside the invite transaction, so the intent cannot exist without the invitation that
   * carries it. `ON DELETE cascade` on both foreign keys is what makes the reverse true.
   */
  setProjectAccess(
    invitationId: string,
    access: readonly InvitationProjectAccess[],
    tx?: DbExecutor,
  ): Promise<void>;

  /** The rows to apply at accept time. Empty for every invitation created before §6.4. */
  listProjectAccess(invitationId: string, tx?: DbExecutor): Promise<InvitationProjectAccess[]>;

  /** Whether every id is a live project in this workspace — validated before the invite is sent. */
  countProjectsInWorkspace(workspaceId: string, projectIds: readonly string[]): Promise<number>;
}
