import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { AccessModule } from '@modules/access';
import { MilestonesService } from './application/milestones.service';
import { MilestonesController } from './interface/http/milestones.controller';
import { MilestoneDrizzleRepository } from './infrastructure/persistence/milestone.drizzle-repository';
import { MILESTONE_REPOSITORY } from './domain/ports/milestone.repository';

@Module({
  imports: [ProjectsModule, AccessModule],
  controllers: [MilestonesController],
  providers: [MilestonesService, { provide: MILESTONE_REPOSITORY, useClass: MilestoneDrizzleRepository }],
  exports: [MilestonesService],
})
export class MilestonesModule {}