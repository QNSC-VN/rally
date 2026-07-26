import { Module } from '@nestjs/common';
import { ActivityLogger } from './application/activity-logger.service';
import { ActivityLogDrizzleRepository } from './infrastructure/persistence/activity-log.drizzle-repository';
import { ACTIVITY_LOG_REPOSITORY } from './domain/ports/activity-log.repository';

/**
 * Shared Revision-History primitive. Any module that records or reads activity
 * imports this and injects {@link ActivityLogger}. One table, one service, one
 * diff — no per-entity activity infrastructure.
 */
@Module({
  providers: [
    ActivityLogger,
    { provide: ACTIVITY_LOG_REPOSITORY, useClass: ActivityLogDrizzleRepository },
  ],
  exports: [ActivityLogger],
})
export class ActivityModule {}
