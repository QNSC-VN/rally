import { Module } from '@nestjs/common';
import { IterationsModule } from '@modules/iterations';
import { WorkItemsModule } from '@modules/work-items';
import { AccessModule } from '@modules/access';
import { TeamStatusService } from './application/team-status.service';
import { TeamStatusController } from './interface/http/team-status.controller';
import { TeamStatusDrizzleRepository } from './infrastructure/persistence/team-status.drizzle-repository';
import { TEAM_STATUS_REPOSITORY } from './domain/ports/team-status.repository';

@Module({
  imports: [IterationsModule, WorkItemsModule, AccessModule],
  controllers: [TeamStatusController],
  providers: [
    TeamStatusService,
    { provide: TEAM_STATUS_REPOSITORY, useClass: TeamStatusDrizzleRepository },
  ],
  exports: [TeamStatusService],
})
export class TeamStatusModule {}