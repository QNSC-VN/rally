import { Module } from '@nestjs/common';
import {
  AuthService,
  EntraTokenVerifier,
  USER_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  SSO_CONNECTION_REPOSITORY,
  ACCESS_SERVICE,
  WORKSPACE_SERVICE,
  AUDIT_SERVICE,
  CLAIMS_PROVIDER,
  TRANSACTION_RUNNER,
  AUTH_SERVICE_OPTIONS,
  ENTRA_VERIFIER_OPTIONS,
} from '@qnsc-vn/identity';
import type { AuthServiceOptions, EntraVerifierOptions } from '@qnsc-vn/identity';
import { AppConfigService } from '@platform';
import { AccessModule, AccessService } from '@modules/access';
import { WorkspaceModule, WorkspaceService } from '@modules/workspace';
import { AuditService } from '@modules/audit';
import { IdentityController } from './interface/http/identity.controller';
import { AuthController } from './interface/http/auth.controller';
import { UserDrizzleRepository } from './infrastructure/persistence/user.drizzle-repository';
import { AuthSessionDrizzleRepository } from './infrastructure/persistence/auth-session.drizzle-repository';
import { SsoConnectionDrizzleRepository } from './infrastructure/persistence/sso-connection.drizzle-repository';
import { RallyClaimsProvider } from './application/claims.provider';
import { DrizzleTransactionRunner } from './application/transaction-runner';

/**
 * Rally's identity module. The refresh-rotation auth engine, Entra token
 * verification, and cookie contract all live in `@qnsc-vn/identity`; rally
 * supplies the product-specific adapters via the shared DI tokens:
 *
 *  - persistence ports  → rally's drizzle repositories
 *  - service ports      → rally's access / workspace / audit services
 *  - claims provider    → rally's permission-based {@link RallyClaimsProvider}
 *  - transaction runner → drizzle `db.transaction`
 *  - token denylist     → `AuthTokenCache` (provided by the global PlatformModule)
 *  - options            → rally's env-driven config
 *
 * Rally keeps its own `JwtStrategy` / guards (extended `JwtPayload`), so the
 * package's `AuthModule.forRoot` is intentionally NOT used here.
 */
@Module({
  imports: [AccessModule, WorkspaceModule],
  controllers: [IdentityController, AuthController],
  providers: [
    AuthService,
    EntraTokenVerifier,

    // Persistence ports → rally drizzle repositories.
    { provide: USER_REPOSITORY, useClass: UserDrizzleRepository },
    { provide: AUTH_SESSION_REPOSITORY, useClass: AuthSessionDrizzleRepository },
    { provide: SSO_CONNECTION_REPOSITORY, useClass: SsoConnectionDrizzleRepository },

    // Service ports → rally's existing domain services.
    { provide: ACCESS_SERVICE, useExisting: AccessService },
    { provide: WORKSPACE_SERVICE, useExisting: WorkspaceService },
    { provide: AUDIT_SERVICE, useExisting: AuditService },

    // Product adapters.
    { provide: CLAIMS_PROVIDER, useClass: RallyClaimsProvider },
    { provide: TRANSACTION_RUNNER, useClass: DrizzleTransactionRunner },

    {
      provide: AUTH_SERVICE_OPTIONS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): AuthServiceOptions => ({
        jwtAccessExpiry: config.get('JWT_ACCESS_EXPIRY'),
        jwtRefreshExpiry: config.get('JWT_REFRESH_EXPIRY'),
        platformAdminEmails: (config.get('PLATFORM_ADMIN_EMAILS') ?? '')
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean),
        nodeEnv: config.get('NODE_ENV'),
      }),
    },
    {
      provide: ENTRA_VERIFIER_OPTIONS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): EntraVerifierOptions => ({
        tenantId: config.get('ENTRA_TENANT_ID') ?? '',
        clientId: config.get('ENTRA_CLIENT_ID') ?? '',
      }),
    },
  ],
  exports: [AuthService],
})
export class IdentityModule {}
