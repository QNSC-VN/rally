import { Module } from '@nestjs/common';
import { ProjectsService } from './application/projects.service';
import { ProjectsController } from './interface/http/projects.controller';
import { ProjectDrizzleRepository } from './infrastructure/persistence/project.drizzle-repository';
import { WorkflowStatusDrizzleRepository } from './infrastructure/persistence/workflow-status.drizzle-repository';
import { LabelDrizzleRepository } from './infrastructure/persistence/label.drizzle-repository';
import { ProjectTeamDrizzleRepository } from './infrastructure/persistence/project-team.drizzle-repository';
import { ProjectMemberDrizzleRepository } from './infrastructure/persistence/project-member.drizzle-repository';
import { PROJECT_REPOSITORY } from './domain/ports/project.repository';
import { WORKFLOW_STATUS_REPOSITORY } from './domain/ports/workflow-status.repository';
import { LABEL_REPOSITORY } from './domain/ports/label.repository';
import { PROJECT_TEAM_REPOSITORY } from './domain/ports/project-team.repository';
import { PROJECT_MEMBER_REPOSITORY } from './domain/ports/project-member.repository';
import { TenancyModule } from '@modules/tenancy';

@Module({
  imports: [TenancyModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    { provide: PROJECT_REPOSITORY, useClass: ProjectDrizzleRepository },
    { provide: WORKFLOW_STATUS_REPOSITORY, useClass: WorkflowStatusDrizzleRepository },
    { provide: LABEL_REPOSITORY, useClass: LabelDrizzleRepository },
    { provide: PROJECT_TEAM_REPOSITORY, useClass: ProjectTeamDrizzleRepository },
    { provide: PROJECT_MEMBER_REPOSITORY, useClass: ProjectMemberDrizzleRepository },
  ],
  exports: [ProjectsService, WORKFLOW_STATUS_REPOSITORY, LABEL_REPOSITORY],
})
export class ProjectsModule {}
