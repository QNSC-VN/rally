import { Module } from '@nestjs/common';
import { TenancyService } from './application/tenancy.service';
import { TeamService } from './application/team.service';
import {
  TenantController,
  WorkspaceController,
  InvitationController,
} from './interface/http/tenancy.controller';
import { TeamController } from './interface/http/team.controller';
import { TenantDrizzleRepository } from './infrastructure/persistence/tenant.drizzle-repository';
import { WorkspaceDrizzleRepository } from './infrastructure/persistence/workspace.drizzle-repository';
import { WorkspaceMemberDrizzleRepository } from './infrastructure/persistence/workspace-member.drizzle-repository';
import { WorkspaceInvitationDrizzleRepository } from './infrastructure/persistence/workspace-invitation.drizzle-repository';
import { WorkspaceSettingsDrizzleRepository } from './infrastructure/persistence/workspace-settings.drizzle-repository';
import { TenantDomainDrizzleRepository } from './infrastructure/persistence/tenant-domain.drizzle-repository';
import { TenantMemberDrizzleRepository } from './infrastructure/persistence/tenant-member.drizzle-repository';
import { TeamDrizzleRepository } from './infrastructure/persistence/team.drizzle-repository';
import { TeamMemberDrizzleRepository } from './infrastructure/persistence/team-member.drizzle-repository';
import { TENANT_REPOSITORY } from './domain/ports/tenant.repository';
import { WORKSPACE_REPOSITORY } from './domain/ports/workspace.repository';
import { WORKSPACE_MEMBER_REPOSITORY } from './domain/ports/workspace-member.repository';
import { WORKSPACE_INVITATION_REPOSITORY } from './domain/ports/workspace-invitation.repository';
import { WORKSPACE_SETTINGS_REPOSITORY } from './domain/ports/workspace-settings.repository';
import { TENANT_DOMAIN_REPOSITORY } from './domain/ports/tenant-domain.repository';
import { TENANT_MEMBER_REPOSITORY } from './domain/ports/tenant-member.repository';
import { TEAM_REPOSITORY } from './domain/ports/team.repository';
import { TEAM_MEMBER_REPOSITORY } from './domain/ports/team-member.repository';

@Module({
  controllers: [TenantController, WorkspaceController, InvitationController, TeamController],
  providers: [
    TenancyService,
    TeamService,
    { provide: TENANT_REPOSITORY, useClass: TenantDrizzleRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: WorkspaceDrizzleRepository },
    { provide: WORKSPACE_MEMBER_REPOSITORY, useClass: WorkspaceMemberDrizzleRepository },
    { provide: WORKSPACE_INVITATION_REPOSITORY, useClass: WorkspaceInvitationDrizzleRepository },
    { provide: WORKSPACE_SETTINGS_REPOSITORY, useClass: WorkspaceSettingsDrizzleRepository },
    { provide: TENANT_DOMAIN_REPOSITORY, useClass: TenantDomainDrizzleRepository },
    { provide: TENANT_MEMBER_REPOSITORY, useClass: TenantMemberDrizzleRepository },
    { provide: TEAM_REPOSITORY, useClass: TeamDrizzleRepository },
    { provide: TEAM_MEMBER_REPOSITORY, useClass: TeamMemberDrizzleRepository },
  ],
  exports: [TenancyService, TeamService, WORKSPACE_MEMBER_REPOSITORY],
})
export class TenancyModule {}
