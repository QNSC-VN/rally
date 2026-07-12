import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  Span,
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
} from '../domain/workspace.types';

/** Workspace member management (list/add/update/remove). */
@Injectable()
export class WorkspaceMemberService {
  private readonly logger = new Logger(WorkspaceMemberService.name);

  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY) private readonly memberRepo: IWorkspaceMemberRepository,
  ) {}

  /** Same existence/ownership check as WorkspaceService.getWorkspace. */
  private async getWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace || workspace.deletedAt) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
    return workspace;
  }

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

    const member = await this.memberRepo.addMember({
      id: uuidv7(),
      workspaceId,
      userId,
      roleId: undefined,
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

  async removeMember(workspaceId: string, userId: string, actorId: string): Promise<void> {
    await this.getWorkspace(workspaceId);

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
}
