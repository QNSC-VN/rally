import { Global, Module } from '@nestjs/common';

import { API_TOKEN_RESOLVER } from '@platform';
import { AccessModule } from '@modules/access';

import { ApiTokenPrincipalResolver } from './application/api-token.resolver';
import { ApiTokensService } from './application/api-tokens.service';
import { ApiTokenDrizzleRepository } from './infrastructure/persistence/api-token.drizzle-repository';
import { ApiTokensAdminController } from './interface/http/api-tokens-admin.controller';
import { ApiTokensController } from './interface/http/api-tokens.controller';
import { RejectApiTokenAuthGuard } from './interface/http/reject-api-token-auth.guard';

/**
 * Machine credentials.
 *
 * `API_TOKEN_RESOLVER` is bound here, which is what activates the platform guard's API-token path: the
 * platform layer declares the seam and keeps no dependency on this module, exactly as it does for the
 * BFF session resolver. A product that leaves this module out has no such path at all — the binding IS
 * the feature flag, so there is no flag to forget to set.
 *
 * `ApiTokensService` is exported for offboarding: deactivating a user must revoke their tokens the same
 * way it revokes their sessions, or their automation keeps working for up to a year.
 *
 * `@Global`, and the DI token is EXPORTED — both are required, for the same reason `IdentityModule` is
 * global for its BFF bridge. `JwtAuthGuard` is constructed in whichever module uses `@Auth()`, so an
 * optional dependency bound only inside this module resolves to `undefined` in every one of them: the
 * guard silently keeps its old behaviour and every API token answers 401 on a route that should accept
 * it. That is not hypothetical — it is what `api-tokens.e2e.spec.ts` caught, and no unit test could,
 * because the binding is correct in isolation and wrong in the graph.
 */
@Global()
@Module({
  imports: [AccessModule],
  controllers: [ApiTokensController, ApiTokensAdminController],
  providers: [
    ApiTokensService,
    ApiTokenDrizzleRepository,
    RejectApiTokenAuthGuard,
    ApiTokenPrincipalResolver,
    { provide: API_TOKEN_RESOLVER, useExisting: ApiTokenPrincipalResolver },
  ],
  exports: [ApiTokensService, API_TOKEN_RESOLVER],
})
export class ApiTokensModule {}
