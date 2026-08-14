import { Module } from '@nestjs/common';
import { IterationsModule } from '@modules/iterations';
import { WorkItemsModule } from '@modules/work-items';
import { AccessModule } from '@modules/access';
import { ProjectsModule } from '@modules/projects';
import { TeamStatusService } from './application/team-status.service';
import { TeamStatusController } from './interface/http/team-status.controller';
import { TeamStatusDrizzleRepository } from './infrastructure/persistence/team-status.drizzle-repository';
import { TEAM_STATUS_REPOSITORY } from './domain/ports/team-status.repository';

/**
 * ProjectsModule is imported for `assertProjectWritable` alone (PRJ-FR-010). Nest will not inject
 * a provider from a module this one only reaches transitively, so the import is direct even though
 * both IterationsModule and WorkItemsModule already depend on it.
 */
@Module({
  imports: [IterationsModule, WorkItemsModule, AccessModule, ProjectsModule],
  controllers: [TeamStatusController],
  providers: [
    TeamStatusService,
    { provide: TEAM_STATUS_REPOSITORY, useClass: TeamStatusDrizzleRepository },
  ],
  exports: [TeamStatusService],
})
export class TeamStatusModule {}
