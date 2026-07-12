import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  PreconditionFailedException,
  AppConfigService,
  Span,
  EmailSchedulerService,
  UnitOfWork,
  TenantRlsService,
  addDays,
} from '@platform';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import {
  IWorkspaceInvitationRepository,
  WORKSPACE_INVITATION_REPOSITORY,
} from '../domain/ports/workspace-invitation.repository';
import {
  IWorkspaceMemberRepository,
  WORKSPACE_MEMBER_REPOSITORY,
} from '../domain/ports/workspace-member.repository';
import {
  ITenantMemberRepository,
  TENANT_MEMBER_REPOSITORY,
} from '../domain/ports/tenant-member.repository';
import type { Workspace, WorkspaceInvitation } from '../domain/tenancy.types';

/** Workspace invitations: invite, list, cancel, accept. */
@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    @Inject(WORKSPACE_INVITATION_REPOSITORY)
    private readonly invitationRepo: IWorkspaceInvitationRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY) private readonly memberRepo: IWorkspaceMemberRepository,
    @Inject(TENANT_MEMBER_REPOSITORY)
    private readonly tenantMemberRepo: ITenantMemberRepository,
    private readonly config: AppConfigService,
    private readonly emailScheduler: EmailSchedulerService,
    private readonly uow: UnitOfWork,
    private readonly rls: TenantRlsService,
  ) {}

  /** Same existence/ownership check as WorkspaceService.getWorkspace. */
  private async getWorkspace(tenantId: string, workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findById(workspaceId, tenantId);
    if (!workspace || workspace.deletedAt || workspace.tenantId !== tenantId) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
    return workspace;
  }

  @Span('tenancy.inviteMember')
  async inviteMember(
    tenantId: string,
    workspaceId: string,
    email: string,
    roleId: string | undefined,
    actorId: string,
  ): Promise<WorkspaceInvitation> {
    const workspace = await this.getWorkspace(tenantId, workspaceId);

    const normalizedEmail = email.toLowerCase().trim();
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invitationTtlDays = this.config.get('INVITATION_TTL_DAYS');
    const expiresAt = addDays(invitationTtlDays);

    const baseUrl = this.config.get('APP_BASE_URL');
    const inviteUrl = `${baseUrl}/accept-invitation?token=${rawToken}`;

    // Atomic: rotate any prior pending invite, create the new one, and enqueue
    // the email in ONE transaction. Either the invitee gets a row AND an email,
    // or nothing is persisted — no dangling invites without a delivery, and no
    // emails pointing at a rolled-back invitation.
    // idempotencyKey = invitation.id: retrying this HTTP request skips the
    // duplicate email_outbox insert.
    const invitation = await this.uow.run(async (tx) => {
      // Rotate on resend (COMPANY-FR-005): cancel any existing pending invite
      await this.invitationRepo.cancelExistingForEmail(workspaceId, normalizedEmail, tx);

      const inv = await this.invitationRepo.create(
        {
          id: uuidv7(),
          tenantId,
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

  async listInvitations(tenantId: string, workspaceId: string): Promise<WorkspaceInvitation[]> {
    await this.getWorkspace(tenantId, workspaceId);
    return this.invitationRepo.listByWorkspace(workspaceId);
  }

  async cancelInvitation(
    tenantId: string,
    workspaceId: string,
    invitationId: string,
    actorId: string,
  ): Promise<void> {
    await this.getWorkspace(tenantId, workspaceId);

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

    await this.rls.withTenantContext(tenantId, (tx) =>
      this.invitationRepo.updateStatus(invitationId, 'cancelled', undefined, tx),
    );
    this.logger.log({ invitationId, actorId }, 'Invitation cancelled');
  }

  @Span('tenancy.acceptInvitation')
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

    // Atomic: enroll the member (if not already one) and mark the invitation
    // accepted together. A partial failure would otherwise let the same
    // invitation be redeemed twice. Tenant context is the invitation's tenant,
    // which is the tenant of every row written here.
    await this.rls.withTenantContext(invitation.tenantId, async (tx) => {
      // 1. Ensure the keycard exists — this is what fixes the "ghost member"
      //    bug where a user from tenant A accepts an invite from tenant B.
      //    Once this row exists, the updated RLS on identity.users lets tenant B
      //    see their profile row through the membership-based policy.
      await this.tenantMemberRepo.create(
        { id: uuidv7(), tenantId: invitation.tenantId, userId: acceptingUserId },
        tx,
      );

      if (!existing) {
        await this.memberRepo.addMember(
          {
            id: uuidv7(),
            tenantId: invitation.tenantId,
            workspaceId: invitation.workspaceId,
            userId: acceptingUserId,
            roleId: invitation.roleId ?? undefined,
          },
          tx,
        );
      }

      await this.invitationRepo.updateStatus(invitation.id, 'accepted', acceptingUserId, tx);
    });

    this.logger.log({ invitationId: invitation.id, acceptingUserId }, 'Invitation accepted');
  }
}
