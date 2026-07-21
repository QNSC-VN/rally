import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import {
  NotFoundException,
  PreconditionFailedException,
  AppConfigService,
  Span,
  EmailSchedulerService,
  UnitOfWork,
  InjectDrizzle,
  addDays,
} from '@platform';
import type { DrizzleDB } from '@platform';
import { NotificationSchedulerService } from '@platform/notifications/notification-scheduler.service';
import { users } from '../../../../../db/schema/identity';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import {
  IWorkspaceInvitationRepository,
  WORKSPACE_INVITATION_REPOSITORY,
} from '../domain/ports/workspace-invitation.repository';
import {
  IWorkspaceMemberRepository,
  WORKSPACE_MEMBER_REPOSITORY,
} from '../domain/ports/workspace-member.repository';
import type { Workspace, WorkspaceInvitation } from '../domain/workspace.types';

/** Workspace invitations: invite, list, cancel, accept. */
@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    @Inject(WORKSPACE_INVITATION_REPOSITORY)
    private readonly invitationRepo: IWorkspaceInvitationRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY) private readonly memberRepo: IWorkspaceMemberRepository,
    private readonly config: AppConfigService,
    private readonly emailScheduler: EmailSchedulerService,
    private readonly notificationScheduler: NotificationSchedulerService,
    private readonly uow: UnitOfWork,
    @InjectDrizzle() private readonly db: DrizzleDB,
  ) {}

  /** Same existence/ownership check as WorkspaceService.getWorkspace. */
  private async getWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace || workspace.deletedAt) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
    return workspace;
  }

  @Span('invitation.inviteMember')
  async inviteMember(
    workspaceId: string,
    email: string,
    roleId: string | undefined,
    actorId: string,
  ): Promise<WorkspaceInvitation> {
    const workspace = await this.getWorkspace(workspaceId);

    const normalizedEmail = email.toLowerCase().trim();
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invitationTtlDays = this.config.get('INVITATION_TTL_DAYS');
    const expiresAt = addDays(invitationTtlDays);

    const baseUrl = this.config.get('APP_BASE_URL');
    const inviteUrl = `${baseUrl}/accept-invitation?token=${rawToken}`;

    const invitation = await this.uow.run(async (tx) => {
      await this.invitationRepo.cancelExistingForEmail(workspaceId, normalizedEmail, tx);

      const inv = await this.invitationRepo.create(
        {
          id: uuidv7(),
          workspaceId,
          email: normalizedEmail,
          roleId,
          tokenHash,
          invitedBy: actorId,
          expiresAt,
        },
        tx,
      );

      await this.emailScheduler.schedule(
        {
          to: normalizedEmail,
          template: 'workspace-invitation',
          vars: {
            inviteUrl,
            workspaceName: workspace.name,
            expiresInDays: String(invitationTtlDays),
            recipientEmail: normalizedEmail,
          },
          idempotencyKey: inv.id,
        },
        tx,
      );

      return inv;
    });

    return invitation;
  }

  async listInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    await this.getWorkspace(workspaceId);
    return this.invitationRepo.listByWorkspace(workspaceId);
  }

  async cancelInvitation(
    workspaceId: string,
    invitationId: string,
    actorId: string,
  ): Promise<void> {
    await this.getWorkspace(workspaceId);

    const invitation = await this.invitationRepo.findById(invitationId);
    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('INVITATION_NOT_FOUND', 'Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new PreconditionFailedException(
        'INVITATION_NOT_PENDING',
        'Invitation is no longer pending',
      );
    }

    await this.invitationRepo.updateStatus(invitationId, 'cancelled');
    this.logger.log({ invitationId, actorId }, 'Invitation cancelled');
  }

  @Span('invitation.acceptInvitation')
  async acceptInvitation(rawToken: string, acceptingUserId: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invitation = await this.invitationRepo.findByTokenHash(tokenHash);

    if (!invitation) {
      throw new NotFoundException('INVITATION_NOT_FOUND', 'Invalid or unknown invitation token');
    }

    if (invitation.status !== 'pending') {
      throw new PreconditionFailedException(
        'INVITATION_ALREADY_USED',
        'Invitation has already been used or cancelled',
      );
    }

    if (invitation.expiresAt < new Date()) {
      throw new PreconditionFailedException('INVITATION_EXPIRED', 'Invitation has expired');
    }

    const existing = await this.memberRepo.findMember(invitation.workspaceId, acceptingUserId);

    // Resolve accepter name + workspace name up front (pure reads, no need to
    // run on the transaction connection) so the notification vars are ready
    // by the time the write transaction opens below.
    const [accepteeRows, workspace] = await Promise.all([
      this.db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, acceptingUserId))
        .limit(1),
      this.getWorkspace(invitation.workspaceId),
    ]);
    const accepteeName = accepteeRows[0]?.displayName ?? 'A user';

    await this.uow.run(async (tx) => {
      if (!existing) {
        await this.memberRepo.addMember(
          {
            id: uuidv7(),
            workspaceId: invitation.workspaceId,
            userId: acceptingUserId,
            roleId: invitation.roleId ?? undefined,
          },
          tx,
        );
      }

      await this.invitationRepo.updateStatus(invitation.id, 'accepted', acceptingUserId, tx);

      // Notify the inviter that their invitation was accepted. Enlisted on the
      // same tx as the membership write (see NotificationSchedulerService) so
      // a crash after commit can't silently drop it, and a rollback can't
      // leave a ghost notification for a membership that never took effect.
      await this.notificationScheduler.schedule(
        {
          workspaceId: invitation.workspaceId,
          recipientId: invitation.invitedBy,
          actorId: acceptingUserId,
          template: 'WORKSPACE_INVITATION_ACCEPTED',
          vars: { workspaceName: workspace.name, accepteeName },
          resourceId: invitation.workspaceId,
          idempotencyKey: `invitation-accepted:${invitation.id}`,
        },
        tx,
      );
    });

    this.logger.log({ invitationId: invitation.id, acceptingUserId }, 'Invitation accepted');
  }
}
