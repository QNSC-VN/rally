import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { AccessModule } from '@modules/access';
import { QUALITY_REPOSITORY } from './domain/ports/quality.repository';
import { QualityService } from './application/quality.service';
import { QualityController } from './interface/http/quality.controller';
import { QualityDrizzleRepository } from './infrastructure/persistence/quality.drizzle-repository';

@Module({
  imports: [ProjectsModule, AccessModule],
  controllers: [QualityController],
  providers: [
    QualityService,
    {
      provide: QUALITY_REPOSITORY,
      useClass: QualityDrizzleRepository,
    },
  ],
  exports: [QualityService],
})
export class QualityModule {}