import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { PlanningService } from './application/planning.service';
import { SprintsController } from './interface/http/sprints.controller';
import { SprintDrizzleRepository } from './infrastructure/persistence/sprint.drizzle-repository';
import { SPRINT_REPOSITORY } from './domain/ports/sprint.repository';

@Module({
  imports: [ProjectsModule],
  controllers: [SprintsController],
  providers: [PlanningService, { provide: SPRINT_REPOSITORY, useClass: SprintDrizzleRepository }],
  exports: [PlanningService],
})
export class PlanningModule {}
