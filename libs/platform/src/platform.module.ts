import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/valkey.module';
import { RequestContextService } from './context/request-context';
import { JwtStrategy } from './auth/jwt.strategy';
import { JwtAuthGuard } from './auth/jwt.guard';
import { PermissionGuard } from './auth/permission.guard';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { OutboxService } from './outbox/outbox.service';
import { TenantRlsService } from './database/tenant-rls.service';
import { EmailService } from './email/email.service';
import { EmailSchedulerService } from './email/email-scheduler.service';
import { EMAIL_PROVIDER } from './email/email.provider';
import { SesEmailProvider } from './email/providers/ses.provider';
import { DevEmailProvider } from './email/providers/dev.provider';
import { ResendEmailProvider } from './email/providers/resend.provider';
import { NotificationSchedulerService } from './notifications/notification-scheduler.service';
import { NotificationPubSubService } from './notifications/notification-pubsub.service';
import { HealthController } from './observability/health.controller';
import { Algorithm } from 'jsonwebtoken';
import { IdempotencyInterceptor } from './http/idempotency.interceptor';
import { HttpLoggingInterceptor } from './http/http-logging.interceptor';
import { ResilienceModule } from './resilience/resilience.module';
import { StorageService } from './storage/storage.service';

@Global()
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CacheModule,

    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        privateKey: config.get('JWT_PRIVATE_KEY'),
        publicKey: config.get('JWT_PUBLIC_KEY'),
        signOptions: {
          algorithm: 'ES256' as Algorithm,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expiresIn: config.get('JWT_ACCESS_EXPIRY') as any,
          issuer: config.get('JWT_ISSUER'),
          audience: config.get('JWT_AUDIENCE'),
        },
        verifyOptions: {
          algorithms: ['ES256'] as Algorithm[],
          issuer: config.get('JWT_ISSUER'),
          audience: config.get('JWT_AUDIENCE'),
        },
      }),
    }),

    TerminusModule,
    ResilienceModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContextService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionGuard,
    // Global rate-limit guard — applies to every route.
    // Use @RateLimit('TIER') to override, @SkipRateLimit() to opt out.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    OutboxService,
    TenantRlsService,
    // Email provider — selected via EMAIL_PROVIDER env var ('ses' | 'resend' | 'dev').
    // All providers share the same IEmailProvider interface; swap without touching business logic.
    // SES: needs MAIL_FROM_EMAIL + IAM ses:SendEmail role (cheapest at scale).
    // Resend: needs RESEND_API_KEY + verified domain (best DX, auto-DKIM, recommended for Phase 0).
    // dev: logs to stdout, no real sending (default).
    {
      provide: EMAIL_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const provider = config.get('EMAIL_PROVIDER');
        if (provider === 'ses') return new SesEmailProvider(config);
        if (provider === 'resend') return new ResendEmailProvider(config);
        return new DevEmailProvider(config);
      },
    },
    EmailService,
    EmailSchedulerService,
    NotificationSchedulerService,
    NotificationPubSubService,
    IdempotencyInterceptor,
    HttpLoggingInterceptor,
    StorageService,
  ],
  exports: [
    AppConfigModule,
    DatabaseModule,
    CacheModule,
    JwtModule,
    RequestContextService,
    JwtAuthGuard,
    PermissionGuard,
    OutboxService,
    TenantRlsService,
    EmailService,
    EmailSchedulerService,
    NotificationSchedulerService,
    NotificationPubSubService,
    IdempotencyInterceptor,
    HttpLoggingInterceptor,
    ResilienceModule,
    StorageService,
  ],
})
export class PlatformModule {}
