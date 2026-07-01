import { Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { workspaceInvitations } from '../../../../../../db/schema/tenancy';
import type {
  WorkspaceInvitation,
  CreateInvitationInput,
  InvitationStatus,
} from '../../domain/tenancy.types';
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
    return (rows[0] as WorkspaceInvitation | undefined) ?? null;
  }

  async findById(id: string): Promise<WorkspaceInvitation | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, id))
      .limit(1);
    return (rows[0] as WorkspaceInvitation | undefined) ?? null;
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
    return (rows[0] as WorkspaceInvitation | undefined) ?? null;
  }

  async listByWorkspace(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const rows = await this.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, workspaceId))
      .orderBy(workspaceInvitations.createdAt);
    return rows as WorkspaceInvitation[];
  }

  async create(input: CreateInvitationInput, tx?: DbExecutor): Promise<WorkspaceInvitation> {
    const rows = await (tx ?? this.db)
      .insert(workspaceInvitations)
      .values({
        id: input.id,
        tenantId: input.tenantId,
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
    return rows[0] as WorkspaceInvitation;
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
