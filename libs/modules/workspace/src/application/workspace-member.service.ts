import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  Span,
  TenantRlsService,
} from '@platform';
import type { CursorPayload, PagedResult } from '@platform';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import {
  IWorkspaceMemberRepository,
  WORKSPACE_MEMBER_REPOSITORY,
} from '../domain/ports/workspace-member.repository';
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceMemberWithProfile,
  UpdateMemberInput,
} from '../domain/tenancy.types';

/** Workspace member management (list/add/update/remove). */
@Injectable()
export class WorkspaceMemberService {
  private readonly logger = new Logger(WorkspaceMemberService.name);

  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY) private readonly memberRepo: IWorkspaceMemberRepository,
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

    const member = await this.rls.withTenantContext(tenantId, (tx) =>
      this.memberRepo.addMember(
        {
          id: uuidv7(),
          tenantId,
          workspaceId,
          userId,
          roleId: undefined,
        },
        tx,
      ),
    );

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

    const updated = await this.rls.withTenantContext(tenantId, (tx) =>
      this.memberRepo.updateMember(memberId, input, tx),
    );
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

    await this.rls.withTenantContext(tenantId, (tx) =>
      this.memberRepo.removeMember(workspaceId, userId, tx),
    );
    this.logger.log({ workspaceId, userId, actorId }, 'Member removed from workspace');
  }
}
