import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { requestContextStorage } from '@platform/context/request-context';
import { ConfigService } from '@nestjs/config';
import { PlatformModule } from '@platform';
import { AuditModule } from '@modules/audit';
import { NotificationsModule } from '@modules/notifications';
import { ReportingModule } from '@modules/reporting';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { AuditConsumer } from './consumers/audit.consumer';
import { SnapshotCronService } from './cron/snapshot.cron';
import { CleanupCronService } from './cron/cleanup.cron';
import { EmailRelayService } from './email/email-relay.service';
import { NotificationRelayService } from './notifications/notification-relay.service';

/**
 * Worker process module.
 * Imports only the bounded contexts that have queue consumers or cron jobs.
 * Shares all platform infrastructure (DB, cache, outbox relay) with the API process.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isDev = configService.get<string>('NODE_ENV') !== 'production';
        const prettyLogs = configService.get<boolean>('LOG_PRETTY') ?? isDev;
        return {
          pinoHttp: {
            level: configService.get<string>('LOG_LEVEL') ?? 'info',
            transport: prettyLogs
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: false } }
              : undefined,
            customProps: () => ({
              service: 'rally-worker',
              env: configService.get<string>('NODE_ENV'),
              version: configService.get<string>('SERVICE_VERSION'),
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
                if (reqCtx.tenantId) result['tenantId'] = reqCtx.tenantId;
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
  ],
  providers: [
    // Transactional outbox → SNS relay
    OutboxRelayService,
    // Email outbox relay → IEmailProvider
    EmailRelayService,
    // Notification outbox relay → in_app_notifications
    NotificationRelayService,
    // SQS long-poll consumers
    AuditConsumer,
    // Scheduled cron jobs
    SnapshotCronService,
    CleanupCronService,
  ],
})
export class WorkerModule {}
