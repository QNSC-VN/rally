import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { createLoggerOptions } from '@qnsc-vn/observability';
import { AppConfigService } from '@platform/config';
import { PlatformModule } from '@platform';
import { AuditModule } from '@modules/audit';
import { NotificationsModule } from '@modules/notifications';
import { ReportingModule } from '@modules/reporting';
import { ScmModule } from '@modules/scm';
import { AuditProjectionRelay } from './audit/audit-projection.relay';
import { SnapshotCronService } from './cron/snapshot.cron';
import { CleanupCronService } from './cron/cleanup.cron';
import { EmailRelayService } from './email/email-relay.service';
import { NotificationRelayService } from './notifications/notification-relay.service';
import { ScmWebhookRelayService } from './scm/scm-webhook-relay.service';
import { ScmBackfillRelayService } from './scm/scm-backfill-relay.service';

/**
 * Worker process module.
 * Imports only the bounded contexts that have relays or cron jobs.
 * Shares all platform infrastructure (DB, cache, outbox relay) with the API process.
 */
@Module({
  imports: [
    // Same shared factory as the API. The worker's own copy of this block had
    // drifted and was missing the `redact` list entirely, so a logged SDK error
    // could have written credentials to CloudWatch.
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        createLoggerOptions({
          serviceName: 'rally-worker',
          nodeEnv: config.get('NODE_ENV'),
          serviceVersion: config.get('SERVICE_VERSION'),
          level: config.get('LOG_LEVEL'),
          pretty: config.get('LOG_PRETTY'),
        }),
    }),
    ScheduleModule.forRoot(),
    PlatformModule,

    // Contexts with relays / cron jobs
    AuditModule,
    NotificationsModule,
    ReportingModule,
    ScmModule,
  ],
  providers: [
    // Transactional outbox → audit_logs projection
    AuditProjectionRelay,
    // Email outbox relay → IEmailProvider
    EmailRelayService,
    // Notification outbox relay → in_app_notifications
    NotificationRelayService,
    // SCM webhook inbox relay → connections/changesets
    ScmWebhookRelayService,
    // SCM backfill jobs relay → GitHub App REST → connections/changesets
    ScmBackfillRelayService,
    // Scheduled cron jobs
    SnapshotCronService,
    CleanupCronService,
  ],
})
export class WorkerModule {}
