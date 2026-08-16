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
import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import { isProjectAccessLevel } from '@shared-kernel';
import { AccessService } from '@modules/access';
import { GuestInviteSchedulerService } from './guest-invite-scheduler.service';
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
import { IUserAccessRevoker, USER_ACCESS_REVOKER } from '../domain/ports/user-access.revoker';
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceMemberOption,
  WorkspaceMemberWithProfile,
  WorkspaceMembership,
  WorkspaceInvitation,
  InvitationProjectAccess,
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
    private readonly access: AccessService,
    private readonly guestInviteScheduler: GuestInviteSchedulerService,
    /**
     * Implemented in `libs/modules/identity` and resolved through its `@Global()` export — see the
     * port's docblock for why the dependency points that way. It is what makes "suspended" and
     * "removed" mean loss of ACCESS rather than loss of permissions.
     */
    @Inject(USER_ACCESS_REVOKER) private readonly userAccess: IUserAccessRevoker,
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

  // `createWorkspace` and `deleteWorkspace` are GONE with `POST /workspaces` and
  // `DELETE /workspaces/:id` (COMPANY-FR-010 / §281 / AC-8 — the route note in
  // `workspace.controller.ts` carries the quotes). Each had exactly one caller, the deleted handler.
  //
  // Nothing legitimate provisioned through either: `db/seeds/bootstrap.ts` writes
  // `workspace.workspaces` directly with drizzle (`onConflictDoUpdate` on the id), `db/migrate.ts`
  // only calls `seed()`, and the boot-time root is `ensureDefaultWorkspace` above — which stays,
  // because a freshly-migrated install still needs something to log into.
  //
  // `IWorkspaceRepository.findBySlug` and `.softDelete` went with them, having had no other reader.
  // The `deleted_at` COLUMN and `getWorkspace`'s check on it stay: nothing writes it through the app
  // any more, but a row an operator retires by hand must still read as absent rather than as a
  // half-live workspace.

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

  // ── Members ──────────────────────────────────────────────────────────────────

  // `listMembers` is GONE with `GET /workspaces/:id/members` — see that route's own note in
  // `workspace.controller.ts`. It had exactly one caller, the deleted handler. The repository method
  // it wrapped is gone too: its only remaining reader was `WorkspaceMemberService`, an orphan no
  // module ever provided, and both went with it.

  /**
   * The ADMINISTRATIVE roster — phone, last login, role ids and team memberships.
   *
   * Authorized at the ROUTE, on `workspace:view` (Workspace Admin only): see the note there for
   * why this feed and the picker feed below are two routes rather than one.
   */
  async listMembersWithProfile(workspaceId: string): Promise<WorkspaceMemberWithProfile[]> {
    await this.getWorkspace(workspaceId);
    return this.memberRepo.listMembersWithProfile(workspaceId);
  }

  /**
   * The ASSIGNEE / OWNER PICKER roster — id, name, email, avatar (RBE-07).
   *
   * WHY THE CHECK IS HERE AND NOT A DECORATOR
   * Every level must be able to resolve a person to a name, so a workspace-tier code is wrong (an
   * Editor holds none) and a project-tier code is unavailable (there is no project in the path —
   * the roster is workspace-wide by construction). What decides it is the one authorization fact
   * behind every cross-project read: {@link AccessService.listReadableProjectIds}. Its `null` means
   * UNRESTRICTED and `[]` means NOTHING, and those are different answers — which is precisely what
   * no static descriptor can carry.
   *
   *   • `null`  (a Workspace Admin) → the whole roster.
   *   • `[]`    (No Access: no active `project_members` row anywhere, and no workspace grant) → an
   *             empty list. Before this, a principal with zero grants read the company directory
   *             including phone numbers and last-login times.
   *   • ids     (an Editor or per-project Admin) → only the people THOSE projects reference.
   *
   * THE LAST CASE IS NARROWED, AND THE PREVIOUS NOTE HERE ARGUED IT COULD NOT BE. That argument was
   * half right and the conclusion was wrong, so both halves are recorded. Measured, the route handed
   * a project Editor every one of 1105 workspace members — the whole company directory, at four
   * fields — where §3.1:62 hides `View company Users` from them. The readable-project list was being
   * used as a BINARY gate ("may you read anything?") and then discarded, which is the same defect
   * class as a boundary that takes a permission and ignores it.
   *
   * What the old note got right: the roster ALONE cannot name a project's owner. §2.1 (migration
   * 0118) keeps a Workspace Admin off every `project_members` roster, and a WA is exactly who tends
   * to own a project — every seeded project's `lead_id` is the admin user, with no membership row by
   * design. A picker narrowed to rosters could neither resolve nor offer the current owner.
   *
   * So the population is the UNION of the two things a readable project actually references: its
   * active members, and its lead. That resolves every owner a reader can see by construction, offers
   * exactly the people their own projects already name, and stops being a directory. The four fields
   * remain the four that are already on screen wherever someone is an assignee, a lead or a team
   * member; the sensitive columns are on the route above.
   */
  async listMemberOptions(workspaceId: string, actorId: string): Promise<WorkspaceMemberOption[]> {
    await this.getWorkspace(workspaceId);
    const readable = await this.access.listReadableProjectIds(workspaceId, actorId, 'project:view');
    // `readable === null` is UNRESTRICTED, so it must be tested for explicitly — `!readable?.length`
    // would collapse it into the empty case and fail closed for a Workspace Admin.
    if (readable !== null && readable.length === 0) return [];
    // `null` travels through as UNRESTRICTED. An empty list cannot reach the repository, so its
    // `inArray` is never handed one — not portable as "match nothing".
    return this.memberRepo.listMemberOptions(workspaceId, readable);
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
      /**
       * The ACCOUNT-level status, in the SAME transaction as the membership flip.
       *
       * AUTH-SSO-006 is about the login path, not the live session: "Inactive/suspended users are
       * denied access even when identity-provider authentication succeeds". Only
       * `identity.users.status` can say that — every login path in `@qnsc-vn/identity` refuses a
       * `suspended | inactive` user (`refresh`, `ssoLogin`, `ssoLoginFromConnection`, `devLogin`,
       * `switchWorkspace`), and NOTHING in this repository had ever written the column: rally's
       * `updateStatus` had zero callers, so the gate could not fire. Without it a suspended member
       * signs straight back in, because `getMemberships` returns no ACTIVE membership and the
       * package reads that as a half-finished provision and self-heals by re-resolving the
       * workspace from the SSO connection.
       *
       * SUSPENSION ONLY, and `removeMember` deliberately does NOT do this. Removal means "not in
       * this workspace", which is a per-workspace fact; `identity.users` is workspace-agnostic, so
       * writing an account disable there would be answering a different question. Suspension is
       * different in kind — the BA's own word for the action is `Disable/suspend` the USER
       * (COMPANY-FR-007), and AUTH-SSO-006 spells it `suspended`.
       *
       * BLAST RADIUS, stated rather than assumed: the column would lock the member out of every
       * workspace they belong to, not just this one. That is bounded to nothing here — the MVP has
       * exactly one workspace (COMPANY-FR-010), and this change also DELETES `POST /workspaces`, so
       * a second one is no longer reachable through the API at all. If self-service workspaces ever
       * return, this write is one of the things that has to be reconsidered with them, which is why
       * it is a labelled one-line call and not spread through the flow.
       *
       * Reversible by construction: reactivation sets it back, below and in the same place.
       */
      if (input.status === 'suspended') {
        await this.userAccess.setAccountStatus(member.userId, 'suspended', tx);
      } else if (input.status === 'active') {
        await this.userAccess.setAccountStatus(member.userId, 'active', tx);
      }
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
    /**
     * §8 / AC-5: company disable or removal takes effect on the user's next request.
     *
     * TWO things, and the second one used to be missing. Invalidating the permission cache makes the
     * next request resolve ZERO permissions instead of waiting out the 5-minute TTL — but zero
     * permissions is not denied access. The suspended member's access token stayed valid and their
     * refresh session stayed live, so they kept a session and landed in the shell, which is the
     * defect AUTH-SSO-006 and AUTH-FR-013 describe. `revokeAllSessions` is the other half.
     *
     * AFTER COMMIT, both of them, and for one reason: neither is transactional. Run inside
     * `uow.run` a rollback would leave a member logged out of a suspension that never happened, and
     * the cache cannot be rolled back at all. Same sequencing `assignRole` and `acceptInvitation`
     * already use for `invalidateUser`.
     */
    if (input.status === 'suspended' || input.status === 'removed') {
      await this.access.invalidateUser(workspaceId, member.userId);
      await this.userAccess.revokeAllSessions(member.userId);
    } else if (input.status === 'active') {
      /**
       * Reinstatement has to clear the per-user token denylist, or it is not a reinstatement: the
       * key stands for `JWT_ACCESS_EXPIRY` and rejects the freshly issued token of anyone who logs
       * in inside that window, with nothing on screen to explain it. `invalidateUser` too — the
       * suspension cached an empty permission set under the same 5-minute TTL.
       */
      await this.access.invalidateUser(workspaceId, member.userId);
      await this.userAccess.restoreSessions(member.userId);
    }
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
    /**
     * §8 / AC-5: removal is effective on the removed member's next request. Both halves, after
     * commit, exactly as in `updateMember` above — the permission cache so nothing resolves, and the
     * sessions so there is no session left to resolve for.
     *
     * `identity.users.status` is deliberately NOT written here. Removal is a statement about THIS
     * workspace ("no longer a member"), and that column is account-level and workspace-agnostic, so
     * setting it would disable the person's account to answer a per-workspace question — and it
     * would not be undone by re-adding them, because `addMember` refuses a user who still has a row
     * (`removeMember` is a soft flip to `status = 'removed'`, so the row survives).
     *
     * THE GAP THIS LEAVES IS REAL AND IS RECORDED, NOT ASSUMED CLOSED: a removed member can still
     * complete an SSO login. `getMemberships` filters `status = 'active'`, so they resolve no
     * workspace, and `@qnsc-vn/identity` reads an empty result as a half-finished provision and
     * self-heals by taking the workspace from the SSO connection instead. They land with no
     * membership row reactivated (`enrollMember` finds the removed row and returns) and zero
     * effective permissions — but they land. Closing it belongs where the decision is made: the
     * login path must consult workspace MEMBERSHIP status, and that path is in the shared package,
     * which CLAUDE.md says to fix there rather than work around here.
     */
    await this.access.invalidateUser(workspaceId, userId);
    await this.userAccess.revokeAllSessions(userId);
    this.logger.log({ workspaceId, userId, actorId }, 'Member removed from workspace');
  }

  // ── Invitations ─────────────────────────────────────────────────────────────

  /** Minimum gap between sends of the same invitation (anti email-bombing). */
  private static readonly RESEND_COOLDOWN_MS = 60_000;

  /** Fresh random invite credential — the raw token is emailed, only its hash stored. */
  private mintInviteToken(): { rawToken: string; tokenHash: string } {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
  }

  /**
   * Enqueue the transactional invitation email (shared by create + resend).
   * `idempotencyKey` MUST be unique per send — email_outbox dedups on it — so
   * create passes the invitation id and resend passes `${id}:r${n}`.
   *
   * Create only reaches this while `ENTRA_GUEST_INVITE_ENABLED` is OFF. With it on, the invitation
   * email is scheduled by `EntraGuestInviteRelayService` once the invitee's Entra guest object
   * exists, because a link that arrives first cannot be acted on — see `inviteMember`. Resend always
   * sends from here; the same docblock says why.
   */
  private async scheduleInviteEmail(
    tx: DbExecutor,
    opts: {
      to: string;
      rawToken: string;
      workspaceName: string;
      ttlDays: number;
      idempotencyKey: string;
    },
  ): Promise<void> {
    const baseUrl = this.config.get('APP_BASE_URL');
    const inviteUrl = `${baseUrl}/accept-invitation?token=${opts.rawToken}`;
    await this.emailScheduler.schedule(
      {
        to: opts.to,
        template: 'workspace-invitation',
        vars: {
          inviteUrl,
          workspaceName: opts.workspaceName,
          expiresInDays: String(opts.ttlDays),
          recipientEmail: opts.to,
        },
        idempotencyKey: opts.idempotencyKey,
      },
      tx,
    );
  }

  /**
   * Validate the initial per-Project access an invitation carries (§6.4), BEFORE the invite is
   * sent.
   *
   * Fail-fast on the inviter's screen, where the mistake can be corrected. The same rules are
   * enforced again by `AccessService.grantProjectAccess` at accept time, and that is not
   * redundancy: days pass in between, and a project deleted or a level retired in the meantime
   * must not turn the invitee's one-click acceptance into an error they cannot act on.
   *
   * The level goes through `isProjectAccessLevel` — the catalogue — and never a hand-written pair.
   * `AccessService` had exactly that bug twice: a literal `'admin' | 'editor'` comparison made a
   * granted row read as No Access while a third level existed (migrations 0113, 0115).
   *
   * Both refusals reuse `VALIDATION_FAILED` rather than minting codes: they describe a malformed
   * request, which is what that code means. The DTO's `z.enum(PROJECT_ACCESS_LEVEL)` already
   * rejects a bad level for HTTP callers; the duplicate rule is only here, on purpose — see the
   * DTO for why that schema must stay a plain object.
   */
  private assertInvitationProjectAccess(
    access: readonly InvitationProjectAccess[],
  ): readonly InvitationProjectAccess[] {
    for (const row of access) {
      // Read as `unknown` deliberately: the declared type says this cannot fail, and inside the
      // failing branch TypeScript narrows it to `never` — but the type is a claim about compiled
      // callers, and this guard exists for the ones that are not (a raw HTTP body, a seed, a
      // future module). Narrowing it away would remove the only check a bad value ever meets.
      const level: unknown = row.accessLevel;
      if (!isProjectAccessLevel(level)) {
        throw new PreconditionFailedException(
          'VALIDATION_FAILED',
          `"${String(level)}" is not a per-Project access level`,
        );
      }
    }
    const projectIds = [...new Set(access.map((a) => a.projectId))];
    if (projectIds.length !== access.length) {
      throw new PreconditionFailedException(
        'VALIDATION_FAILED',
        'The same project appears twice in the initial access list',
      );
    }
    return access;
  }

  @Span('workspace.inviteMember')
  async inviteMember(
    workspaceId: string,
    email: string,
    roleId: string | undefined,
    actorId: string,
    /**
     * The projects and levels the invitee lands with (§6.4, RBE-11). Empty is the pre-§6.4
     * behaviour and stays legal: an invitation with no rows grants no initial project access, and
     * the invitee is No Access until someone grants them a level.
     */
    projectAccess: readonly InvitationProjectAccess[] = [],
  ): Promise<WorkspaceInvitation> {
    const workspace = await this.getWorkspace(workspaceId);

    const access = this.assertInvitationProjectAccess(projectAccess);
    if (access.length > 0) {
      const found = await this.invitationRepo.countProjectsInWorkspace(
        workspaceId,
        access.map((a) => a.projectId),
      );
      if (found !== access.length) {
        throw new PreconditionFailedException(
          'PROJECT_NOT_FOUND',
          'One or more selected projects do not exist in this workspace',
        );
      }
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { rawToken, tokenHash } = this.mintInviteToken();
    const ttlDays = this.config.get('INVITATION_TTL_DAYS');
    const expiresAt = addDays(ttlDays);

    // Atomic: rotate any prior pending invite, create the new one, and enqueue the outbox work in
    // ONE transaction. idempotencyKey = invitation.id so retrying the request skips the duplicate
    // insert — and so the two possible writers of this email (here, or the guest-invite relay once
    // provisioning resolves) can never both produce one.
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

      // Inside the invite transaction: the intent cannot exist without the invitation carrying
      // it, and `ON DELETE cascade` on both foreign keys makes the reverse true too.
      await this.invitationRepo.setProjectAccess(inv.id, access, tx);

      /**
       * Provision the invitee as an Entra B2B GUEST, so a collaborator on a non-staff mailbox can
       * actually sign in — Entra verifies them through their own Microsoft work account, Google
       * federation, or an emailed one-time passcode — while THIS invitation stays the authorization
       * gate. Staff are unaffected: they are already directory members, and Graph reports that as a
       * collision the relay records as "nothing to do".
       *
       * Same seam and same reason as the email below: an intent written in this transaction, a
       * worker relay owning the network call. No-op while `ENTRA_GUEST_INVITE_ENABLED` is off.
       *
       * IT ALSO TAKES OVER THE EMAIL when it is on, which is why it comes first and why the raw
       * token goes with it (migration 0124). Both rows used to be written here and drained by two
       * independent relays — the email relay every 5s AND woken instantly, the guest relay on a 30s
       * cron with no wake signal — so the invitee got their link in under a second and their
       * directory object up to 30s later, plus Microsoft's replication lag. Clicking immediately
       * then cannot authenticate at all (`NO_CONNECTION`, or Entra's own `AADSTS50020`), which is
       * indistinguishable from the feature being broken. The email is therefore scheduled by
       * whoever KNOWS the guest is ready: the relay, in the same transaction that marks the row
       * `sent`. Ordering, not tuning — a faster cron would only shorten the window.
       */
      const provisioningQueued = await this.guestInviteScheduler.schedule(tx, {
        invitationId: inv.id,
        workspaceId,
        email: normalizedEmail,
        inviteToken: rawToken,
      });

      /**
       * Flag OFF — nothing was enqueued, so no relay pass will ever schedule this email and it has
       * to go out from here, exactly as it did before guest provisioning existed. Staff onboarding
       * is the default path and must not regress in any way.
       *
       * `idempotencyKey` is `inv.id` in BOTH writers, so a flag flipped between the enqueue and the
       * relay pass cannot produce two invitation emails: `email_outbox.idempotency_key` is UNIQUE
       * and both inserts are `ON CONFLICT DO NOTHING`.
       */
      if (!provisioningQueued) {
        await this.scheduleInviteEmail(tx, {
          to: normalizedEmail,
          rawToken,
          workspaceName: workspace.name,
          ttlDays,
          idempotencyKey: inv.id,
        });
      }

      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_MEMBER_INVITED,
          resourceType: AUDIT_RESOURCE.WORKSPACE_INVITATION,
          resourceId: inv.id,
          workspaceId,
          actor: { id: actorId },
          // The initial grant is part of what was invited, so it belongs in the audit record —
          // otherwise "who gave this person access to that project" has no answer for the most
          // common path there is.
          changes: { after: { email: normalizedEmail, roleId, projectAccess: access } },
        },
        tx,
      );

      return inv;
    });

    return invitation;
  }

  /**
   * Resend an invitation: rotate to a fresh token + expiry on the SAME row
   * (invalidating the old emailed link), revive it to `pending` if it had
   * lapsed, and re-send the email. Guarded by status (pending|expired) and a
   * per-invite cooldown; the route also carries @RateLimit('STRICT').
   */
  @Span('workspace.resendInvitation')
  async resendInvitation(
    workspaceId: string,
    invitationId: string,
    actorId: string,
  ): Promise<WorkspaceInvitation> {
    const workspace = await this.getWorkspace(workspaceId);

    const invitation = await this.invitationRepo.findById(invitationId);
    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('INVITATION_NOT_FOUND', 'Invitation not found');
    }
    if (invitation.status !== 'pending' && invitation.status !== 'expired') {
      throw new PreconditionFailedException(
        'INVITATION_NOT_PENDING',
        'Only a pending or expired invitation can be resent',
      );
    }
    if (Date.now() - invitation.lastSentAt.getTime() < WorkspaceService.RESEND_COOLDOWN_MS) {
      throw new PreconditionFailedException(
        'INVITATION_RESEND_TOO_SOON',
        'This invitation was just sent — please wait a moment before resending',
      );
    }

    const { rawToken, tokenHash } = this.mintInviteToken();
    const ttlDays = this.config.get('INVITATION_TTL_DAYS');
    const expiresAt = addDays(ttlDays);

    const updated = await this.uow.run(async (tx) => {
      const inv = await this.invitationRepo.rotateForResend(
        invitationId,
        { tokenHash, expiresAt, lastSentAt: new Date() },
        tx,
      );

      await this.scheduleInviteEmail(tx, {
        to: inv.email,
        rawToken,
        workspaceName: workspace.name,
        ttlDays,
        // Fresh key per send — resendCount was just incremented by rotateForResend.
        idempotencyKey: `${inv.id}:r${inv.resendCount}`,
      });

      /**
       * Guest provisioning keys on `inv.id`, NOT on the resend counter, so this is a no-op whenever
       * the intent already exists — one invitation must never produce two directory writes. What it
       * does buy: an invitation sent while `ENTRA_GUEST_INVITE_ENABLED` was off has no row at all,
       * and Resend is then the way to provision it once the tenant grant lands, with no need to
       * cancel and re-invite.
       *
       * NO `inviteToken`, so this row owes no email and the send above stays INLINE — three reasons,
       * and they all point the same way. (1) A duplicate enqueue is swallowed, so an email hung off
       * this row would never be scheduled at all in the ordinary case where the row already exists.
       * (2) Resend has just ROTATED the token, and the queued row still holds the superseded one —
       * the relay refuses to mail a token whose hash no longer matches, so hanging the email here
       * would mail nothing. (3) The ordering problem this whole change exists to fix cannot arise:
       * the 60s resend cooldown starts at invite time, and the guest relay is woken immediately and
       * polls every 10s, so provisioning has long since resolved (or dead-lettered loudly) by the
       * time a resend is even permitted. Resend is therefore also the manual escape hatch for an
       * invitee whose provisioning failed.
       */
      await this.guestInviteScheduler.schedule(tx, {
        invitationId: inv.id,
        workspaceId,
        email: inv.email,
      });

      await this.audit.emit(
        {
          action: AUDIT_ACTION.WORKSPACE_INVITATION_RESENT,
          resourceType: AUDIT_RESOURCE.WORKSPACE_INVITATION,
          resourceId: inv.id,
          workspaceId,
          actor: { id: actorId },
          changes: { after: { email: inv.email, resendCount: inv.resendCount } },
        },
        tx,
      );

      return inv;
    });

    this.logger.log(
      { invitationId, actorId, resendCount: updated.resendCount },
      'Invitation resent',
    );
    return updated;
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

    /**
     * The invitation is bound to its RECIPIENT — by directory object where we have one, and by
     * address otherwise.
     *
     * Without any binding, acceptance validated only `pending` + not-expired, so the token was a
     * bearer capability: anyone who obtained the link — a forwarded mail, a shared inbox, a copied
     * URL — joined the workspace at the invited role. An invitation is an identity binding, and §5.2
     * step 4 says so ("Existing/new user accept đúng email").
     *
     * WHY THE OID IS PREFERRED, AND WHY THE EMAIL ALONE IS NOT ENOUGH. The email we compare against
     * arrives in the Entra token's `email` claim, and Microsoft states outright that "apps should
     * never use the email claim for authorization purposes". Entra normally strips an email claim
     * whose domain owner is unverified — but that mitigation EXEMPTS SINGLE-TENANT APPS, which this
     * is. So a guest homed in a tenant they control can set their own `mail` attribute to any string
     * and have it arrive here as fact. An invitation naming a valuable role (say a Project Admin for
     * a partner's lead) could then be redeemed by a different guest who simply renamed themselves.
     *
     * `entra_guest_object_id` is the guest's object id IN OUR TENANT, returned by Graph as
     * `invitedUser.id` when the relay provisions them, and it is not settable by the guest. We
     * compare it against `sso_identities.provider_sub`, which is written from the token's `oid` claim
     * at provisioning — the same unspoofable value, recorded on our side.
     *
     * WHY THIS IS A FALLBACK AND NOT A REPLACEMENT. `entra_guest_object_id` is NULL for two ordinary
     * cases, and refusing them would break both: an invitation to a colleague who is already a
     * DIRECTORY MEMBER (the relay records that collision as "nothing to do" and writes no oid,
     * because a member needs no guest object), and any invitation created before this column existed
     * or while `ENTRA_GUEST_INVITE_ENABLED` was off. Those keep the address comparison, which is
     * exactly as strong as it ever was — and note the population the weaker check now covers is
     * staff, whose email claim comes from our own directory rather than a tenant someone else runs.
     *
     * Both refusals share `INVITATION_EMAIL_MISMATCH`. The reader-facing meaning is identical — you
     * are signed in as somebody else — and the accept page already offers sign-out-and-retry for it;
     * a second code would add a state with no distinct action behind it.
     *
     * The address comparison is case-insensitive, because an IdP may return a differently-cased local
     * part than the address the admin typed, and the two are the same mailbox.
     */
    if (invitation.entraGuestObjectId) {
      const subjects = await this.memberRepo.findSsoSubjects(acceptingUserId, 'entra');
      /**
       * Compared case-INSENSITIVELY, for the same reason the address is. The two sides come from
       * differently-typed columns: `entra_guest_object_id` is `uuid`, which Postgres always renders in
       * canonical lower case, while `sso_identities.provider_sub` is a varchar holding the `oid` claim
       * verbatim. A provider that ever emitted an upper-case GUID would otherwise lock a legitimate
       * invitee out of their own invitation — the failure would look like the spoofing refusal and be
       * indistinguishable from it in the log.
       */
      const expected = invitation.entraGuestObjectId.toLowerCase();
      if (!subjects.some((s) => s.toLowerCase() === expected)) {
        /**
         * Logged, and logged with BOTH ids, because this refusal has two very different causes and
         * they are otherwise indistinguishable: someone redeeming an invitation that is not theirs,
         * or our own assumption being wrong. The binding rests on Graph's `invitedUser.id` being the
         * same value as the `oid` claim that tenant issues for the guest — true per Microsoft's
         * documentation (both are the object id IN THE INVITING TENANT), but if it ever is not, every
         * guest-provisioned invitation would refuse here and look exactly like an attack.
         *
         * Object ids are not secrets — they are directory identifiers, already visible to the guest in
         * their own token — so this discloses nothing a log reader should not see, and it turns a
         * silent lockout into a one-line diagnosis. `subjectCount` distinguishes "wrong object" from
         * "this user has no Entra identity at all", which is a different fault again.
         */
        this.logger.warn({
          msg: 'Invitation refused: guest object id does not match the accepting user',
          invitationId: invitation.id,
          expectedGuestObjectId: expected,
          acceptingUserSubjects: subjects,
          subjectCount: subjects.length,
        });
        throw new PreconditionFailedException(
          'INVITATION_EMAIL_MISMATCH',
          'This invitation was sent to a different email address',
        );
      }
    } else {
      const acceptingEmail = await this.memberRepo.findUserEmail(acceptingUserId);
      if (!acceptingEmail || acceptingEmail.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new PreconditionFailedException(
          'INVITATION_EMAIL_MISMATCH',
          'This invitation was sent to a different email address',
        );
      }
    }

    const existing = await this.memberRepo.findMember(invitation.workspaceId, acceptingUserId);

    /**
     * The initial per-Project access this invitation carries (§6.4, RBE-11).
     *
     * Read AFTER the email binding above, and applied inside the transaction below, so a forwarded
     * or shared link cannot collect a grant: `INVITATION_EMAIL_MISMATCH` is thrown before anything
     * here runs. That ordering is the whole point — before §6.4 a leaked token bought workspace
     * membership at the invited role; with §6.4 it would buy per-project Admin as well.
     */
    const projectAccess = await this.invitationRepo.listProjectAccess(invitation.id);

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

      /**
       * The invited ROLE, written where permissions are actually read from.
       *
       * `addMember` above sets `workspace_members.role_id`, which is denormalised and authoritative
       * for nothing: `AccessService` resolves permissions from `user_role_assignments`, and this
       * module's own members query reads the role from there too. So the invited role used to be
       * written to a column nobody reads — a user invited as Project Admin landed with whatever
       * `ensureDefaultRole` gives a first-time SSO login, and the admin who sent the invitation saw
       * the intended role nowhere and was never told the grant had not happened.
       *
       * Inside the same transaction as the membership and the status flip: a partial success here
       * would enrol someone with no role at all.
       */
      if (invitation.roleId) {
        /**
         * The 3-level model grants per-Project access ONLY via
         * `project_members.access_level`. A workspace-scoped grant of a per-Project
         * TIER role (project_admin / project_member) would hand the invitee the full
         * delivery set across EVERY project — exactly the legacy over-grant migration
         * 0111 deletes. The FE invites email-only (lands No Access until a WA grants
         * levels), but the API still accepts an arbitrary roleId, so validate here:
         * tier roles are refused loudly instead of silently over-granting.
         */
        const invitedRole = await this.access.findRole(invitation.workspaceId, invitation.roleId);
        if (
          invitedRole &&
          (invitedRole.slug === 'project_admin' || invitedRole.slug === 'project_member')
        ) {
          throw new ConflictException(
            'INVITED_ROLE_IS_PROJECT_TIER',
            'Per-Project roles cannot be granted at invitation; grant per-Project access levels after the member joins',
          );
        }
        await this.memberRepo.grantWorkspaceRole(
          {
            workspaceId: invitation.workspaceId,
            userId: acceptingUserId,
            roleId: invitation.roleId,
            grantedBy: acceptingUserId,
          },
          tx,
        );
      }

      /**
       * §6.4 — the invited per-Project access, applied beside the role grant and in the SAME
       * transaction as the membership it depends on. Which is exactly why
       * `grantProjectAccess` takes a `tx`: its active-workspace-member check has to see the
       * `addMember` row written a few lines above, and `UnitOfWork.run` is `db.transaction`, which
       * does not nest — so a second transaction could neither see it nor roll back with it.
       *
       * `onWorkspaceAdmin: 'skip'`: a Workspace Admin already has every project through the
       * workspace-wide grant (§2.1 keeps them out of project rosters), so writing nothing is the
       * correct answer. Refusing instead would make the invitation permanently unredeemable for
       * someone who is already an admin of this workspace.
       */
      for (const row of projectAccess) {
        await this.access.grantProjectAccess(
          {
            workspaceId: invitation.workspaceId,
            projectId: row.projectId,
            userId: acceptingUserId,
            accessLevel: row.accessLevel,
            actorId: acceptingUserId,
            onWorkspaceAdmin: 'skip',
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

    // The grant has to land on the accepting user's NEXT request, not at token expiry: PolicyGuard
    // caches resolved permissions per (workspace, user) for 5 minutes, and this user was already
    // authenticated in order to accept — so a stale entry from before the grant is the normal case.
    // After commit, matching `assignRole`. The per-Project grants above are the caller's to
    // invalidate for exactly this reason: `grantProjectAccess` ran inside the transaction and
    // cannot know when it committed.
    if (invitation.roleId || projectAccess.length > 0) {
      await this.access.invalidateUser(invitation.workspaceId, acceptingUserId);
    }

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
