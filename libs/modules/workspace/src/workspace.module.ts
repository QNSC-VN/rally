import { Module, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { WorkspaceService } from './application/workspace.service';
import { TeamService } from './application/team.service';
import { WorkspaceController, InvitationController } from './interface/http/workspace.controller';
import { TeamController } from './interface/http/team.controller';
import { WorkspaceDrizzleRepository } from './infrastructure/persistence/workspace.drizzle-repository';
import { WorkspaceMemberDrizzleRepository } from './infrastructure/persistence/workspace-member.drizzle-repository';
import { WorkspaceInvitationDrizzleRepository } from './infrastructure/persistence/workspace-invitation.drizzle-repository';
import { WorkspaceSettingsDrizzleRepository } from './infrastructure/persistence/workspace-settings.drizzle-repository';
import { TeamDrizzleRepository } from './infrastructure/persistence/team.drizzle-repository';
import { TeamMemberDrizzleRepository } from './infrastructure/persistence/team-member.drizzle-repository';
import { WORKSPACE_REPOSITORY } from './domain/ports/workspace.repository';
import { WORKSPACE_MEMBER_REPOSITORY } from './domain/ports/workspace-member.repository';
import { WORKSPACE_INVITATION_REPOSITORY } from './domain/ports/workspace-invitation.repository';
import { WORKSPACE_SETTINGS_REPOSITORY } from './domain/ports/workspace-settings.repository';
import { TEAM_REPOSITORY } from './domain/ports/team.repository';
import { TEAM_MEMBER_REPOSITORY } from './domain/ports/team-member.repository';

@Module({
  controllers: [WorkspaceController, InvitationController, TeamController],
  providers: [
    WorkspaceService,
    TeamService,
    { provide: WORKSPACE_REPOSITORY, useClass: WorkspaceDrizzleRepository },
    { provide: WORKSPACE_MEMBER_REPOSITORY, useClass: WorkspaceMemberDrizzleRepository },
    { provide: WORKSPACE_INVITATION_REPOSITORY, useClass: WorkspaceInvitationDrizzleRepository },
    { provide: WORKSPACE_SETTINGS_REPOSITORY, useClass: WorkspaceSettingsDrizzleRepository },
    { provide: TEAM_REPOSITORY, useClass: TeamDrizzleRepository },
    { provide: TEAM_MEMBER_REPOSITORY, useClass: TeamMemberDrizzleRepository },
  ],
  exports: [WorkspaceService, TeamService, WORKSPACE_MEMBER_REPOSITORY],
})
export class WorkspaceModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkspaceModule.name);

  constructor(private readonly workspace: WorkspaceService) {}

  /**
   * Ensure a root workspace exists on boot so a freshly-migrated install is
   * immediately usable. Idempotent and non-fatal: a DB that isn't reachable yet
   * must not crash the app.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.workspace.ensureDefaultWorkspace();
    } catch (err) {
      this.logger.error({ err }, 'Failed to ensure default workspace on bootstrap');
    }
  }
}
