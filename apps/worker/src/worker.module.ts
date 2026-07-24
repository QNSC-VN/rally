import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { requestContextStorage } from '@platform/context/request-context';
import { AppConfigService } from '@platform/config';
import { PlatformModule } from '@platform';
import { AuditModule } from '@modules/audit';
import { NotificationsModule } from '@modules/notifications';
import { ReportingModule } from '@modules/reporting';
import { ScmModule } from '@modules/scm';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { AuditConsumer } from './consumers/audit.consumer';
import { SnapshotCronService } from './cron/snapshot.cron';
import { CleanupCronService } from './cron/cleanup.cron';
import { EmailRelayService } from './email/email-relay.service';
import { NotificationRelayService } from './notifications/notification-relay.service';
import { ScmWebhookRelayService } from './scm/scm-webhook-relay.service';
import { ScmBackfillRelayService } from './scm/scm-backfill-relay.service';

/**
 * Worker process module.
 * Imports only the bounded contexts that have queue consumers or cron jobs.
 * Shares all platform infrastructure (DB, cache, outbox relay) with the API process.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const isDev = config.get('NODE_ENV') !== 'production';
        const prettyLogs = config.get('LOG_PRETTY') ?? isDev;
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL'),
            transport: prettyLogs
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: false } }
              : undefined,
            customProps: () => ({
              service: 'rally-worker',
              env: config.get('NODE_ENV'),
              version: config.get('SERVICE_VERSION'),
            }),
            mixin: () => {
              const result: Record<string, unknown> = {};
              const span = trace.getActiveSpan();
              if (span) {
                const ctx = span.spanContext();
                if (isSpanContextValid(ctx)) {
                  result['trace.id'] = ctx.traceId;
                  result['span.id'] = ctx.spanId;
                }
              }
              const reqCtx = requestContextStorage.getStore();
              if (reqCtx) {
                if (reqCtx.workspaceId) result['workspaceId'] = reqCtx.workspaceId;
                if (reqCtx.userId) result['userId'] = reqCtx.userId;
                if (reqCtx.correlationId) result['correlationId'] = reqCtx.correlationId;
              }
              return result;
            },
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
    PlatformModule,

    // Contexts with SQS consumers / cron jobs
    AuditModule,
    NotificationsModule,
    ReportingModule,
    ScmModule,
  ],
  providers: [
    // Transactional outbox → SNS relay
    OutboxRelayService,
    // Email outbox relay → IEmailProvider
    EmailRelayService,
    // Notification outbox relay → in_app_notifications
    NotificationRelayService,
    // SCM webhook inbox relay → connections/changesets
    ScmWebhookRelayService,
    // SCM backfill jobs relay → GitHub App REST → connections/changesets
    ScmBackfillRelayService,
    // SQS long-poll consumers
    AuditConsumer,
    // Scheduled cron jobs
    SnapshotCronService,
    CleanupCronService,
  ],
})
export class WorkerModule {}
