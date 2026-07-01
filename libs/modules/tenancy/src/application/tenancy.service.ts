import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  PreconditionFailedException,
  AppConfigService,
  Span,
  EmailSchedulerService,
  UnitOfWork,
  TenantRlsService,
  addDays,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
import { ITenantRepository, TENANT_REPOSITORY } from '../domain/ports/tenant.repository';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import {
  IWorkspaceMemberRepository,
  WORKSPACE_MEMBER_REPOSITORY,
} from '../domain/ports/workspace-member.repository';
import {
  IWorkspaceInvitationRepository,
  WORKSPACE_INVITATION_REPOSITORY,
} from '../domain/ports/workspace-invitation.repository';
import {
  IWorkspaceSettingsRepository,
  WORKSPACE_SETTINGS_REPOSITORY,
} from '../domain/ports/workspace-settings.repository';
import {
  ITenantDomainRepository,
  TENANT_DOMAIN_REPOSITORY,
} from '../domain/ports/tenant-domain.repository';
import {
  ITenantMemberRepository,
  TENANT_MEMBER_REPOSITORY,
} from '../domain/ports/tenant-member.repository';
import type {
  Tenant,
  Workspace,
  WorkspaceMember,
  WorkspaceMemberWithProfile,
  WorkspaceInvitation,
  WorkspaceSettings,
  UpdateWorkspaceInput,
  UpdateMemberInput,
  UpdateWorkspaceSettingsInput,
  ProvisionedTenant,
  AutoJoinTarget,
  TenantMembership,
} from '../domain/tenancy.types';

@Injectable()
export class TenancyService {
  private readonly logger = new Logger(TenancyService.name);

  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenantRepo: ITenantRepository,
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY) private readonly memberRepo: IWorkspaceMemberRepository,
    @Inject(WORKSPACE_INVITATION_REPOSITORY)
    private readonly invitationRepo: IWorkspaceInvitationRepository,
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepo: IWorkspaceSettingsRepository,
    @Inject(TENANT_DOMAIN_REPOSITORY)
    private readonly tenantDomainRepo: ITenantDomainRepository,
    @Inject(TENANT_MEMBER_REPOSITORY)
    private readonly tenantMemberRepo: ITenantMemberRepository,
    private readonly config: AppConfigService,
    private readonly emailScheduler: EmailSchedulerService,
    private readonly uow: UnitOfWork,
    private readonly rls: TenantRlsService,
  ) {}

  // ── Self-serve provisioning (signup) ─────────────────────────────────────────

  /**
   * Provision a brand-new tenant for self-serve signup: tenant + default
   * workspace + trial subscription, all atomically. When a corporate email
   * domain is supplied, an UNVERIFIED domain claim is recorded so an admin can
   * later verify it and enable auto-join (the enterprise domain-capture seam).
   */
  @Span('tenancy.provisionTenant')
  async provisionTenant(orgName: string, primaryDomain: string | null): Promise<ProvisionedTenant> {
    const tenantId = uuidv7();
    const slug = `${this.slugify(orgName)}-${randomBytes(3).toString('hex')}`.slice(0, 63);

    // A brand-new tenant has no pre-existing request context, so we run the
    // provisioning writes inside the NEW tenant's own RLS context — every row
    // created here belongs to this tenant, satisfying the RLS policies.
    return this.rls.withTenantContext(tenantId, async (tx) => {
      const tenant = await this.tenantRepo.create({ id: tenantId, slug, name: orgName }, tx);

      const workspace = await this.workspaceRepo.create(
        { id: uuidv7(), tenantId: tenant.id, slug: 'main', name: orgName },
        tx,
      );

      // Trial subscription — payment later flips this to active via billing webhook.
      await this.tenantRepo.createSubscription(tenant.id, 'free', 'trialing', tx);

      if (primaryDomain) {
        await this.tenantDomainRepo.create(
          { id: uuidv7(), tenantId: tenant.id, domain: primaryDomain, verified: null, allowAutoJoin: false },
          tx,
        );
      }

      this.logger.log({ tenantId: tenant.id, slug, primaryDomain }, 'Tenant provisioned via signup');
      return { tenant, workspace };
    });
  }

  /**
   * Resolve the tenant/workspace a signup should auto-join based on a verified,
   * auto-join-enabled domain claim. Returns null when no such claim exists, in
   * which case the caller provisions a fresh tenant instead.
   */
  /** Returns true if the domain is already claimed by any tenant (auto-join or not). */
  async isDomainClaimed(domain: string): Promise<boolean> {
    const claim = await this.tenantDomainRepo.findByDomain(domain.toLowerCase());
    return claim !== null;
  }

  async findAutoJoinTarget(domain: string): Promise<AutoJoinTarget | null> {
    const claim = await this.tenantDomainRepo.findByDomain(domain.toLowerCase());
    if (!claim || !claim.verified || !claim.allowAutoJoin) return null;

    const workspaces = await this.workspaceRepo.listByTenant(claim.tenantId, {
      limit: 1,
      cursor: null,
    });
    const workspace = workspaces.data[0];
    if (!workspace) return null;

    return { tenantId: claim.tenantId, workspaceId: workspace.id };
  }

  /** Enroll a user as an active member of a workspace (used during signup). */
  async enrollMember(
    tenantId: string,
    workspaceId: string,
    userId: string,
    roleId?: string,
  ): Promise<void> {
    // Ensure the tenant-level keycard exists first (idempotent — safe to call
    // even if provisionTenant already inserted one for the founding user).
    await this.tenantMemberRepo.create({ id: uuidv7(), tenantId, userId });
    await this.memberRepo.addMember({ id: uuidv7(), tenantId, workspaceId, userId, roleId });
  }

  /**
   * Return all active tenant memberships for a user, most-recently-active first.
   * Used at login to resolve the active tenant and populate the switcher list.
   */
  async getMemberships(userId: string): Promise<TenantMembership[]> {
    return this.tenantMemberRepo.findByUserId(userId);
  }

  /** Return a single tenant membership (keycard) for a user+tenant pair. */
  async getTenantMember(userId: string, tenantId: string) {
    return this.tenantMemberRepo.findByUserAndTenant(userId, tenantId);
  }

  /** Idempotently create a tenant_members keycard for a user. */
  async tenantMemberCreate(id: string, tenantId: string, userId: string): Promise<void> {
    await this.tenantMemberRepo.create({ id, tenantId, userId });
  }

  /**
   * Stamp last_active_at on a user's keycard so that next login auto-selects
   * the tenant they were most recently active in (Linear-style switcher).
   */
  async touchTenantMembership(userId: string, tenantId: string): Promise<void> {
    await this.tenantMemberRepo.touchLastActive(userId, tenantId);
  }

  /** Slugify an org name into a URL-safe tenant slug fragment. */
  private slugify(name: string): string {
    return (
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'org'
    );
  }

  // ── Tenant ──────────────────────────────────────────────────────────────────

  async getTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('TENANT_NOT_FOUND', 'Tenant not found');
    }
    if (tenant.status === 'suspended') {
      throw new UnauthorizedException('TENANT_SUSPENDED', 'Tenant is suspended');
    }
    return tenant;
  }

  // ── Workspaces ──────────────────────────────────────────────────────────────

  async listWorkspaces(
    tenantId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Workspace>> {
    return this.workspaceRepo.listByTenant(tenantId, args);
  }

  @Span('tenancy.createWorkspace')
  async createWorkspace(
    actor: JwtPayload,
    slug: string,
    name: string,
    description?: string,
    avatarUrl?: string,
  ): Promise<Workspace> {
    const existing = await this.workspaceRepo.findBySlug(actor.tenantId, slug);
    if (existing) {
      throw new ConflictException('WORKSPACE_SLUG_TAKEN', `Slug "${slug}" is already taken`);
    }

    // Atomic: create the workspace and enroll the creator as admin together.
    // A partial failure here would otherwise orphan a workspace its own creator
    // cannot access.
    const workspace = await this.uow.run(async (tx) => {
      const ws = await this.workspaceRepo.create(
        {
          id: uuidv7(),
          tenantId: actor.tenantId,
          slug,
          name,
          description,
          avatarUrl,
        },
        tx,
      );

      await this.memberRepo.addMember(
        {
          id: uuidv7(),
          tenantId: actor.tenantId,
          workspaceId: ws.id,
          userId: actor.sub,
        },
        tx,
      );

      return ws;
    });

    this.logger.log({ workspaceId: workspace.id, userId: actor.sub }, 'Workspace created');
    return workspace;
  }

  async getWorkspace(tenantId: string, workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace || workspace.deletedAt || workspace.tenantId !== tenantId) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
    return workspace;
  }

  async updateWorkspace(
    tenantId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): Promise<Workspace> {
    const workspace = await this.getWorkspace(tenantId, workspaceId);

    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new PreconditionFailedException('VALIDATION_FAILED', 'Workspace name cannot be empty');
    }

    return this.workspaceRepo.update(workspace.id, input);
  }

  async deleteWorkspace(tenantId: string, workspaceId: string): Promise<void> {
    await this.getWorkspace(tenantId, workspaceId);
    await this.workspaceRepo.softDelete(workspaceId);
    this.logger.log({ workspaceId }, 'Workspace soft-deleted');
  }

  // ── Members ──────────────────────────────────────────────────────────────────

  async listMembers(
    tenantId: string,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkspaceMember>> {
    await this.getWorkspace(tenantId, workspaceId);
    return this.memberRepo.listMembers(workspaceId, args);
  }

  async listMembersWithProfile(
    tenantId: string,
    workspaceId: string,
  ): Promise<WorkspaceMemberWithProfile[]> {
    await this.getWorkspace(tenantId, workspaceId);
    return this.memberRepo.listMembersWithProfile(workspaceId);
  }

  @Span('tenancy.addMember')
  async addMember(
    tenantId: string,
    workspaceId: string,
    userId: string,
    actorId: string,
  ): Promise<WorkspaceMember> {
    await this.getWorkspace(tenantId, workspaceId);

    const existing = await this.memberRepo.findMember(workspaceId, userId);
    if (existing) {
      throw new ConflictException(
        'WORKSPACE_MEMBER_ALREADY_EXISTS',
        'User is already a member of this workspace',
      );
    }

    const member = await this.memberRepo.addMember({
      id: uuidv7(),
      tenantId,
      workspaceId,
      userId,
      roleId: undefined,
    });

    this.logger.log({ workspaceId, userId, actorId }, 'Member added to workspace');
    return member;
  }

  async updateMember(
    tenantId: string,
    workspaceId: string,
    memberId: string,
    input: UpdateMemberInput,
    actorId: string,
  ): Promise<WorkspaceMember> {
    await this.getWorkspace(tenantId, workspaceId);

    const member = await this.memberRepo.findMemberById(memberId);
    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException(
        'WORKSPACE_MEMBER_NOT_FOUND',
        'Member not found in this workspace',
      );
    }

    // Sole-admin invariant: cannot suspend/remove/demote the last active admin
    if ((input.status === 'suspended' || input.status === 'removed') && member.roleId === 'admin') {
      const adminCount = await this.memberRepo.countActiveAdmins(workspaceId);
      if (adminCount <= 1) {
        throw new PreconditionFailedException(
          'SOLE_ADMIN_VIOLATION',
          'Cannot suspend or remove the last workspace admin',
        );
      }
    }

    const updated = await this.memberRepo.updateMember(memberId, input);
    this.logger.log({ workspaceId, memberId, actorId }, 'Member updated');
    return updated;
  }

  async removeMember(
    tenantId: string,
    workspaceId: string,
    userId: string,
    actorId: string,
  ): Promise<void> {
    await this.getWorkspace(tenantId, workspaceId);

    const existing = await this.memberRepo.findMember(workspaceId, userId);
    if (!existing) {
      throw new NotFoundException(
        'WORKSPACE_MEMBER_NOT_FOUND',
        'Member not found in this workspace',
      );
    }

    await this.memberRepo.removeMember(workspaceId, userId);
    this.logger.log({ workspaceId, userId, actorId }, 'Member removed from workspace');
  }

  // ── Invitations ─────────────────────────────────────────────────────────────
  @Span('tenancy.inviteMember') async inviteMember(
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

    await this.invitationRepo.updateStatus(invitationId, 'cancelled');
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

  // ── Settings ─────────────────────────────────────────────────────────────────

  async getSettings(tenantId: string, workspaceId: string): Promise<WorkspaceSettings> {
    await this.getWorkspace(tenantId, workspaceId);
    const settings = await this.settingsRepo.findByWorkspace(workspaceId);
    if (!settings) {
      // Return defaults if not configured
      return {
        id: '',
        workspaceId,
        tenantId,
        timezone: null,
        defaultLocale: null,
        dateFormat: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return settings;
  }

  async updateSettings(
    tenantId: string,
    workspaceId: string,
    input: UpdateWorkspaceSettingsInput,
  ): Promise<WorkspaceSettings> {
    await this.getWorkspace(tenantId, workspaceId);
    return this.settingsRepo.upsert(workspaceId, tenantId, input);
  }
}
