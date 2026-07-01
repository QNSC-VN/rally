import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { requestContextStorage } from '@platform/context/request-context';
import { PlatformModule } from '@platform';
import { IdentityModule } from '@modules/identity';
import { TenancyModule } from '@modules/tenancy';
import { AccessModule } from '@modules/access';
import { ProjectsModule } from '@modules/projects';
import { WorkItemsModule } from '@modules/work-items';
import { PlanningModule } from '@modules/planning';
import { ReleasesModule } from '@modules/releases';
import { WorkflowModule } from '@modules/workflow';
import { CollaborationModule } from '@modules/collaboration';
import { NotificationsModule } from '@modules/notifications';
import { AuditModule } from '@modules/audit';
import { ReportingModule } from '@modules/reporting';
import { GlobalExceptionFilter } from '@platform/http/global-exception.filter';
import { HttpLoggingInterceptor } from '@platform/http/http-logging.interceptor';
import { ZodValidationPipe } from 'nestjs-zod';
import { SanitizationPipe } from '@platform/pipes/sanitization.pipe';
import { AsyncLocalStorageMiddleware } from '@platform/context/als.middleware';

@Module({
  imports: [
    // Pino structured logging — autoLogging disabled; HttpLoggingInterceptor handles per-request logs
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isDev = configService.get<string>('NODE_ENV') !== 'production';
        const prettyLogs = configService.get<boolean>('LOG_PRETTY') ?? isDev;
        return {
          pinoHttp: {
            level: configService.get<string>('LOG_LEVEL') ?? 'info',
            // pino-pretty for human-readable logs in dev; JSON in prod for log aggregators
            transport: prettyLogs
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: false } }
              : undefined,
            // Never log credentials in any environment
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.headers["x-api-key"]',
                'req.headers["x-csrf-token"]',
              ],
              censor: '[REDACTED]',
            },
            // HttpLoggingInterceptor emits the per-request summary line
            autoLogging: false,
            customProps: () => ({
              service: 'rally-api',
              env: configService.get<string>('NODE_ENV'),
              version: configService.get<string>('SERVICE_VERSION'),
            }),
            // mixin: called on every log write — injects active OTEL trace context
            // and ALS request context (tenantId, userId, correlationId) automatically.
            mixin: () => {
              const result: Record<string, unknown> = {};

              // Trace-log correlation: link this log line to the active OTEL span
              const span = trace.getActiveSpan();
              if (span) {
                const ctx = span.spanContext();
                if (isSpanContextValid(ctx)) {
                  result['trace.id'] = ctx.traceId;
                  result['span.id'] = ctx.spanId;
                }
              }

              // Request context: tenantId / userId / correlationId from ALS
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

    // Platform (config, db, auth, cache, outbox, observability)
    PlatformModule,

    // Bounded contexts
    IdentityModule,
    TenancyModule,
    AccessModule,
    ProjectsModule,
    WorkItemsModule,
    PlanningModule,
    ReleasesModule,
    WorkflowModule,
    CollaborationModule,
    NotificationsModule,
    AuditModule,
    ReportingModule,
  ],
  providers: [
    // Global exception filter → stable RFC-9457-style error envelope
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Global interceptor: structured HTTP access log (replaces pino-http autoLogging)
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },

    // Global pipes — order matters: sanitize XSS BEFORE Zod validates shape
    { provide: APP_PIPE, useClass: SanitizationPipe },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // AsyncLocalStorage middleware — sets correlationId + tenant/user stubs for every request
    consumer.apply(AsyncLocalStorageMiddleware).forRoutes('*path');
  }
}
