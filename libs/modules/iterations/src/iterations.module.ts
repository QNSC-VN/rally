import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { WorkItemsModule } from '@modules/work-items';
import { AccessModule } from '@modules/access';
import { IterationsService } from './application/iterations.service';
import { IterationStatusService } from './application/iteration-status.service';
import { IterationsController } from './interface/http/iterations.controller';
import { IterationDrizzleRepository } from './infrastructure/persistence/iteration.drizzle-repository';
import { IterationStatusDrizzleRepository } from './infrastructure/persistence/iteration-status.drizzle-repository';
import { ITERATION_REPOSITORY } from './domain/ports/iteration.repository';
import { ITERATION_STATUS_REPOSITORY } from './domain/ports/iteration-status.repository';

@Module({
  imports: [ProjectsModule, WorkItemsModule, AccessModule],
  controllers: [IterationsController],
  providers: [
    IterationsService,
    IterationStatusService,
    { provide: ITERATION_REPOSITORY, useClass: IterationDrizzleRepository },
    { provide: ITERATION_STATUS_REPOSITORY, useClass: IterationStatusDrizzleRepository },
  ],
  exports: [IterationsService],
})
export class IterationsModule {}
