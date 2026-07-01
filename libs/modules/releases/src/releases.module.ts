import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { ReleasesService } from './application/releases.service';
import { ReleasesController } from './interface/http/releases.controller';
import { ReleaseDrizzleRepository } from './infrastructure/persistence/release.drizzle-repository';
import { RELEASE_REPOSITORY } from './domain/ports/release.repository';

@Module({
  imports: [ProjectsModule],
  controllers: [ReleasesController],
  providers: [ReleasesService, { provide: RELEASE_REPOSITORY, useClass: ReleaseDrizzleRepository }],
  exports: [ReleasesService],
})
export class ReleasesModule {}
