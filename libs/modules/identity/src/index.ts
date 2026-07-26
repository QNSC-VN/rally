export * from './identity.module';
export * from './interface/http/dto/login.dto';
export * from './interface/http/dto/auth-response.dto';
export * from './interface/http/decorators/current-user.decorator';
// Concrete SECRET_RESOLVER implementation — the API gets it via the @Global
// IdentityModule, but the worker (which doesn't import IdentityModule) provides
// it directly for SCM backfill; see apps/worker/src/worker.module.ts.
export * from './infrastructure/secrets-manager-secret-resolver';
