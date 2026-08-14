import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import {
  workspaceInvitations,
  workspaceInvitationProjectAccess,
} from '../../../../../../db/schema/workspace';
import { projects } from '../../../../../../db/schema/work';
import type {
  WorkspaceInvitation,
  CreateInvitationInput,
  InvitationProjectAccess,
  InvitationStatus,
} from '../../domain/workspace.types';
import { IWorkspaceInvitationRepository } from '../../domain/ports/workspace-invitation.repository';

@Injectable()
export class WorkspaceInvitationDrizzleRepository implements IWorkspaceInvitationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByTokenHash(tokenHash: string): Promise<WorkspaceInvitation | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<WorkspaceInvitation | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPendingByEmail(
    workspaceId: string,
    email: string,
  ): Promise<WorkspaceInvitation | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.email, email),
          eq(workspaceInvitations.status, 'pending'),
          gt(workspaceInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listByWorkspace(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const rows = await this.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, workspaceId))
      .orderBy(workspaceInvitations.createdAt, asc(workspaceInvitations.id));
    return rows;
  }

  async create(input: CreateInvitationInput, tx?: DbExecutor): Promise<WorkspaceInvitation> {
    const rows = await (tx ?? this.db)
      .insert(workspaceInvitations)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        email: input.email,
        roleId: input.roleId ?? null,
        tokenHash: input.tokenHash,
        status: 'pending',
        invitedBy: input.invitedBy,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return rows[0];
  }

  async updateStatus(
    id: string,
    status: InvitationStatus,
    acceptedBy?: string,
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? this.db)
      .update(workspaceInvitations)
      .set({
        status,
        ...(acceptedBy !== undefined && { acceptedBy, acceptedAt: new Date() }),
        updatedAt: new Date(),
      })
      .where(eq(workspaceInvitations.id, id));
  }

  async rotateForResend(
    id: string,
    input: { tokenHash: string; expiresAt: Date; lastSentAt: Date },
    tx?: DbExecutor,
  ): Promise<WorkspaceInvitation> {
    const rows = await (tx ?? this.db)
      .update(workspaceInvitations)
      .set({
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        status: 'pending',
        lastSentAt: input.lastSentAt,
        resendCount: sql`${workspaceInvitations.resendCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(workspaceInvitations.id, id))
      .returning();
    return rows[0];
  }

  async setProjectAccess(
    invitationId: string,
    access: readonly InvitationProjectAccess[],
    tx?: DbExecutor,
  ): Promise<void> {
    if (access.length === 0) return;
    // No delete-then-insert: this only ever runs on a freshly created invitation row, and a
    // re-invite to the same address CANCELS the old row and creates a new one rather than editing
    // it (see `cancelExistingForEmail`), so there is never a prior set to replace. The unique index
    // is the backstop if that ever changes.
    await (tx ?? this.db).insert(workspaceInvitationProjectAccess).values(
      access.map((a) => ({
        invitationId,
        projectId: a.projectId,
        accessLevel: a.accessLevel,
      })),
    );
  }

  async listProjectAccess(
    invitationId: string,
    tx?: DbExecutor,
  ): Promise<InvitationProjectAccess[]> {
    const rows = await (tx ?? this.db)
      .select({
        projectId: workspaceInvitationProjectAccess.projectId,
        accessLevel: workspaceInvitationProjectAccess.accessLevel,
      })
      .from(workspaceInvitationProjectAccess)
      .where(eq(workspaceInvitationProjectAccess.invitationId, invitationId))
      // Ends on the surrogate `id`: `project_id` is unique only per invitation, and a partial
      // ORDER BY leaves tied rows in an order SQL does not define — see
      // `test/query-ordering.ratchet.spec.ts`, whose baseline is zero.
      .orderBy(
        asc(workspaceInvitationProjectAccess.projectId),
        asc(workspaceInvitationProjectAccess.id),
      );
    return rows as InvitationProjectAccess[];
  }

  async countProjectsInWorkspace(
    workspaceId: string,
    projectIds: readonly string[],
  ): Promise<number> {
    if (projectIds.length === 0) return 0;
    // `deleted_at IS NULL` deliberately, unlike `TeamRepository.countProjectsInWorkspace`: this
    // validates the target of a grant that will be applied DAYS later, and a soft-deleted project
    // is one `grantProjectAccess` refuses with PROJECT_NOT_FOUND — so admitting it here would move
    // the failure from the inviter's screen, where it can be fixed, to the invitee's.
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          isNull(projects.deletedAt),
          inArray(projects.id, [...projectIds]),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async cancelExistingForEmail(workspaceId: string, email: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(workspaceInvitations)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.email, email),
          eq(workspaceInvitations.status, 'pending'),
        ),
      );
  }
}
