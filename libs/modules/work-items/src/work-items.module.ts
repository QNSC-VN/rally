import { Module } from '@nestjs/common';
import { ProjectsModule } from '@modules/projects';
import { WorkItemsService } from './application/work-items.service';
import { WorkItemsController } from './interface/http/work-items.controller';
import { WorkItemDrizzleRepository } from './infrastructure/persistence/work-item.drizzle-repository';
import { ActivityLogDrizzleRepository } from './infrastructure/persistence/activity-log.drizzle-repository';
import { TimeLogDrizzleRepository } from './infrastructure/persistence/time-log.drizzle-repository';
import { WatcherDrizzleRepository } from './infrastructure/persistence/watcher.drizzle-repository';
import { AttachmentDrizzleRepository } from './infrastructure/persistence/attachment.drizzle-repository';
import { WORK_ITEM_REPOSITORY } from './domain/ports/work-item.repository';
import { ACTIVITY_LOG_REPOSITORY } from './domain/ports/activity-log.repository';
import { TIME_LOG_REPOSITORY } from './domain/ports/time-log.repository';
import { WATCHER_REPOSITORY } from './domain/ports/watcher.repository';
import { ATTACHMENT_REPOSITORY } from './domain/ports/attachment.repository';

@Module({
  imports: [ProjectsModule],
  controllers: [WorkItemsController],
  providers: [
    WorkItemsService,
    // StorageService is provided globally by PlatformModule — no need to re-register here.
    { provide: WORK_ITEM_REPOSITORY, useClass: WorkItemDrizzleRepository },
    { provide: ACTIVITY_LOG_REPOSITORY, useClass: ActivityLogDrizzleRepository },
    { provide: TIME_LOG_REPOSITORY, useClass: TimeLogDrizzleRepository },
    { provide: WATCHER_REPOSITORY, useClass: WatcherDrizzleRepository },
    { provide: ATTACHMENT_REPOSITORY, useClass: AttachmentDrizzleRepository },
  ],
  exports: [WorkItemsService],
})
export class WorkItemsModule {}
