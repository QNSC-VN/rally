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
  AuditProducer,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
  addDays,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import {
  ITeamMemberRepository,
  TEAM_MEMBER_REPOSITORY,
} from '../domain/ports/team-member.repository';
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
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceMemberWithProfile,
  WorkspaceMembership,
  WorkspaceInvitation,
  WorkspaceSettings,
  UpdateWorkspaceInput,
  UpdateMemberInput,
  UpdateWorkspaceSettingsInput,
} from '../domain/workspace.types';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY) private readonly memberRepo: IWorkspaceMemberRepository,
    @Inject(TEAM_MEMBER_REPOSITORY) private readonly teamMemberRepo: ITeamMemberRepository,
    @Inject(WORKSPACE_INVITATION_REPOSITORY)
    private readonly invitationRepo: IWorkspaceInvitationRepository,
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepo: IWorkspaceSettingsRepository,
    private readonly config: AppConfigService,
    private readonly emailScheduler: EmailSchedulerService,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditProducer,
  ) {}

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  /**
   * Ensure at least one workspace exists so a freshly-migrated install has a
   * root to log into. Idempotent: does nothing once any workspace exists.
   */
  @Span('workspace.ensureDefaultWorkspace')
  async ensureDefaultWorkspace(): Promise<Workspace | null> {
    const existing = await this.workspaceRepo.count();
    if (existing > 0) return null;

    const workspace = await this.workspaceRepo.create({
      id: uuidv7(),
      slug: 'default',
      name: 'Default Workspace',
    });
    this.logger.log({ workspaceId: workspace.id }, 'Default workspace provisioned on bootstrap');
    return workspace;
  }

  // ── Membership (login/switch) ───────────────────────────────────────────────

  /**
   * All active workspace memberships for a user, most-recently-active first.
   * Used at login to resolve the active workspace and populate the switcher.
   */
  async getMemberships(userId: string): Promise<WorkspaceMembership[]> {
    return this.memberRepo.findMembershipsForUser(userId);
  }

  /** Return the membership record for a user+workspace pair, or null. */
  async getMembership(userId: string, workspaceId: string): Promise<WorkspaceMember | null> {
    return this.memberRepo.findMember(workspaceId, userId);
  }

  /**
   * Stamp last_active_at on a user's membership so next login auto-selects the
   * workspace they were most recently active in (Linear-style switcher).
   */
  async touchMembership(userId: string, workspaceId: string): Promise<void> {
    await this.memberRepo.touchLastActive(userId, workspaceId);
  }

  /** Enroll a user as an active member of a workspace (idempotent). */
  async enrollMember(workspaceId: string, userId: string, roleId?: string): Promise<void> {
    const existing = await this.memberRepo.findMember(workspaceId, userId);
    if (existing) return;
    await this.memberRepo.addMember({ id: uuidv7(), workspaceId, userId, roleId });
  }

  /**
   * Provision a fresh root workspace and enroll the creator as its first member.
   * Used for administrative bootstrap and (optionally) first-user signup.
   */
  @Span('workspace.provisionWorkspace')
  async provisionWorkspace(name: string, creatorUserId: string): Promise<Workspace> {
    const slug = `${this.slugify(name)}-${randomBytes(3).toString('hex')}`.slice(0, 63);
    return this.uow.run(async (tx) => {
      const workspace = await this.workspaceRepo.create({ id: uuidv7(), slug, name }, tx);
      await this.memberRepo.addMember(
        { id: uuidv7(), workspaceId: workspace.id, userId: creatorUserId },
        tx,
      );
      this.logger.log({ workspaceId: workspace.id, creatorUserId }, 'Workspace provisioned');
      return workspace;
    });
  }

  private slugify(name: string): string {
    return (
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace'
    );
  }

  // ── Workspaces ──────────────────────────────────────────────────────────────

  async listWorkspacesForUser(
    userId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Workspace>> {
    return this.workspaceRepo.listForUser(userId, args);
  }

  @Span('workspace.createWorkspace')
  async createWorkspace(
    actor: JwtPayload,
    slug: string,
    name: string,
    description?: string,
    avatarUrl?: string,
  ): Promise<Workspace> {
    const existing = await this.workspaceRepo.findBySlug(slug);
    if (existing) {
      throw new ConflictException('WORKSPACE_SLUG_TAKEN', `Slug "${slug}" is already taken`);
    }

    // Atomic: create the workspace and enroll the creator together. A partial
    // failure would otherwise orphan a workspace its own creator cannot access.
    const workspace = await this.uow.run(async (tx) => {
      const ws = await this.workspaceRepo.create(
        { id: uuidv7(), slug, name, description, avatarUrl },
        tx,
      );
      await this.memberRepo.addMember({ id: uuidv7(), workspaceId: ws.id, userId: actor.sub }, tx);
      return ws;
    });

    this.logger.log({ workspaceId: workspace.id, userId: actor.sub }, 'Workspace created');
    return workspace;
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace || workspace.deletedAt) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
    if (workspace.status === 'archived') {
      throw new UnauthorizedException('WORKSPACE_ARCHIVED', 'Workspace is archived');
    }
    return workspace;
  }

  async updateWorkspace(
    workspaceId: string,
    input: UpdateWorkspaceInput,
    actorId: string,
  ): Promise<Workspace> {
    const before = await this.getWorkspace(workspaceId);

    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new PreconditionFailedException('VALIDATION_FAILED', 'Workspace name cannot be empty');
    }

    return this.uow.run(async (tx) => {
      const after = await this.workspaceRepo.update(workspaceId, input, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_UPDATED,
          resourceType: AUDIT_RESOURCE.WORKSPACE,
          resourceId: workspaceId,
          workspaceId,
          actor: { id: actorId },
          changes: { before, after },
        },
        tx,
      );
      return after;
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.getWorkspace(workspaceId);
    await this.workspaceRepo.softDelete(workspaceId);
    this.logger.log({ workspaceId }, 'Workspace soft-deleted');
  }

  // ── Members ──────────────────────────────────────────────────────────────────

  async listMembers(
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkspaceMember>> {
    await this.getWorkspace(workspaceId);
    return this.memberRepo.listMembers(workspaceId, args);
  }

  async listMembersWithProfile(workspaceId: string): Promise<WorkspaceMemberWithProfile[]> {
    await this.getWorkspace(workspaceId);
    return this.memberRepo.listMembersWithProfile(workspaceId);
  }

  @Span('workspace.addMember')
  async addMember(workspaceId: string, userId: string, actorId: string): Promise<WorkspaceMember> {
    await this.getWorkspace(workspaceId);

    const existing = await this.memberRepo.findMember(workspaceId, userId);
    if (existing) {
      throw new ConflictException(
        'WORKSPACE_MEMBER_ALREADY_EXISTS',
        'User is already a member of this workspace',
      );
    }

    const member = await this.uow.run(async (tx) => {
      const created = await this.memberRepo.addMember(
        {
          id: uuidv7(),
          workspaceId,
          userId,
          roleId: undefined,
        },
        tx,
      );
      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_MEMBER_ADDED,
          resourceType: AUDIT_RESOURCE.WORKSPACE_MEMBER,
          resourceId: created.id,
          workspaceId,
          actor: { id: actorId },
          changes: { after: created },
        },
        tx,
      );
      return created;
    });

    this.logger.log({ workspaceId, userId, actorId }, 'Member added to workspace');
    return member;
  }

  async updateMember(
    workspaceId: string,
    memberId: string,
    input: UpdateMemberInput,
    actorId: string,
  ): Promise<WorkspaceMember> {
    await this.getWorkspace(workspaceId);

    const member = await this.memberRepo.findMemberById(memberId);
    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException(
        'WORKSPACE_MEMBER_NOT_FOUND',
        'Member not found in this workspace',
      );
    }

    // Sole-admin invariant: cannot suspend/remove the last active admin. Admin
    // status is derived from the authoritative role-assignment tables.
    if (input.status === 'suspended' || input.status === 'removed') {
      const isAdmin = await this.memberRepo.isActiveAdmin(workspaceId, member.userId);
      if (isAdmin) {
        const adminCount = await this.memberRepo.countActiveAdmins(workspaceId);
        if (adminCount <= 1) {
          throw new PreconditionFailedException(
            'SOLE_ADMIN_VIOLATION',
            'Cannot suspend or remove the last workspace admin',
          );
        }
      }
    }

    const updated = await this.uow.run(async (tx) => {
      // Member row only carries role/status; team memberships are reconciled separately.
      const next = await this.memberRepo.updateMember(
        memberId,
        { roleId: input.roleId, status: input.status },
        tx,
      );
      if (input.teamIds !== undefined) {
        await this.teamMemberRepo.setTeamsForUser(workspaceId, member.userId, input.teamIds, tx);
      }
      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_MEMBER_UPDATED,
          resourceType: AUDIT_RESOURCE.WORKSPACE_MEMBER,
          resourceId: memberId,
          workspaceId,
          actor: { id: actorId },
          changes: { before: member, after: { ...next, teamIds: input.teamIds } },
        },
        tx,
      );
      return next;
    });
    this.logger.log({ workspaceId, memberId, actorId }, 'Member updated');
    return updated;
  }

  async removeMember(workspaceId: string, userId: string, actorId: string): Promise<void> {
    await this.getWorkspace(workspaceId);

    const existing = await this.memberRepo.findMember(workspaceId, userId);
    if (!existing) {
      throw new NotFoundException(
        'WORKSPACE_MEMBER_NOT_FOUND',
        'Member not found in this workspace',
      );
    }

    const isAdmin = await this.memberRepo.isActiveAdmin(workspaceId, userId);
    if (isAdmin) {
      const adminCount = await this.memberRepo.countActiveAdmins(workspaceId);
      if (adminCount <= 1) {
        throw new PreconditionFailedException(
          'SOLE_ADMIN_VIOLATION',
          'Cannot remove the last workspace admin',
        );
      }
    }

    await this.uow.run(async (tx) => {
      await this.memberRepo.removeMember(workspaceId, userId, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_MEMBER_REMOVED,
          resourceType: AUDIT_RESOURCE.WORKSPACE_MEMBER,
          resourceId: existing.id,
          workspaceId,
          actor: { id: actorId },
          changes: { before: existing },
        },
        tx,
      );
    });
    this.logger.log({ workspaceId, userId, actorId }, 'Member removed from workspace');
  }

  // ── Invitations ─────────────────────────────────────────────────────────────

  @Span('workspace.inviteMember')
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

    // Atomic: rotate any prior pending invite, create the new one, and enqueue
    // the email in ONE transaction. idempotencyKey = invitation.id so retrying
    // the request skips the duplicate email_outbox insert.
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

      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_MEMBER_INVITED,
          resourceType: AUDIT_RESOURCE.WORKSPACE_INVITATION,
          resourceId: inv.id,
          workspaceId,
          actor: { id: actorId },
          changes: { after: { email: normalizedEmail, roleId } },
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

    await this.uow.run(async (tx) => {
      await this.invitationRepo.updateStatus(invitationId, 'cancelled', undefined, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_INVITATION_CANCELLED,
          resourceType: AUDIT_RESOURCE.WORKSPACE_INVITATION,
          resourceId: invitationId,
          workspaceId,
          actor: { id: actorId },
          changes: { before: { email: invitation.email, status: invitation.status } },
        },
        tx,
      );
    });
    this.logger.log({ invitationId, actorId }, 'Invitation cancelled');
  }

  @Span('workspace.acceptInvitation')
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
    // invitation be redeemed twice.
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

      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_INVITATION_ACCEPTED,
          resourceType: AUDIT_RESOURCE.WORKSPACE_INVITATION,
          resourceId: invitation.id,
          workspaceId: invitation.workspaceId,
          actor: { id: acceptingUserId },
          changes: { after: { email: invitation.email, status: 'accepted' } },
        },
        tx,
      );
    });

    this.logger.log({ invitationId: invitation.id, acceptingUserId }, 'Invitation accepted');
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  async getSettings(workspaceId: string): Promise<WorkspaceSettings> {
    await this.getWorkspace(workspaceId);
    const settings = await this.settingsRepo.findByWorkspace(workspaceId);
    if (!settings) {
      return {
        id: '',
        workspaceId,
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
    workspaceId: string,
    input: UpdateWorkspaceSettingsInput,
    actorId: string,
  ): Promise<WorkspaceSettings> {
    await this.getWorkspace(workspaceId);
    const before = await this.settingsRepo.findByWorkspace(workspaceId);
    return this.uow.run(async (tx) => {
      const after = await this.settingsRepo.upsert(workspaceId, input, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_SETTINGS_UPDATED,
          resourceType: AUDIT_RESOURCE.WORKSPACE,
          resourceId: workspaceId,
          workspaceId,
          actor: { id: actorId },
          changes: { before, after },
        },
        tx,
      );
      return after;
    });
  }
}
