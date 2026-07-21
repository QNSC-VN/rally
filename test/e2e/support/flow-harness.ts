/**
 * Shared bootstrap + fixtures for the BA business-flow E2E suite.
 *
 * These specs boot the REAL rally `AppModule` (real Nest DI, real Drizzle
 * against the seeded `rally-postgres`) and drive the REAL application services,
 * exactly as the HTTP controllers do. Nothing is stubbed: the flows are proven
 * end-to-end against the same code and database the running server uses.
 *
 * The BA "project scope + flow" spec these tests encode lives in
 * product-docs/projects/mini-rally/testing/E2E_BUSINESS_FLOW_COVERAGE.md
 * (flows E2E-001 … E2E-009).
 *
 * Prereqs: docker deps up (`docker compose -f docker-compose.dev.yml up -d`)
 * and the DB seeded (`pnpm db:seed`). Config is read from `.env` by
 * @nestjs/config, so the suite runs against the same connection/tenant as dev.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import type { JwtPayload } from '@platform';
import { PlatformModule } from '@platform';
import { NotificationsModule } from '@modules/notifications';

import { AppModule } from '../../../apps/api/src/app.module';
import { NotificationRelayService } from '../../../apps/worker/src/notifications/notification-relay.service';
import { EmailRelayService } from '../../../apps/worker/src/email/email-relay.service';

// ── Seed fixtures (see db/seeds/seed.ts) ──────────────────────────────────────
export const WORKSPACE_ID = '00000000-0000-7000-8000-000000000003';
/** Seeded `workspace_admin` — carries `workspace:*`. */
export const ADMIN_USER_ID = '00000000-0000-7000-8000-000000000002';
/** Seeded `project_member` at workspace scope. */
export const DEVELOPER_ID = '00000000-0000-7000-8000-000000000020';
/** Seeded `project_viewer` at workspace scope — read-only. */
export const VIEWER_ID = '00000000-0000-7000-8000-000000000021';

/** Boot the real AppModule with a Fastify adapter (no port bound). */
export async function bootRallyApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // init() runs onModuleInit (DB pool, cache) without binding a port.
  await app.init();
  return app;
}

/**
 * Boot just enough of the real Worker to exercise the notification + email
 * relay's actual fetchBatch/processRow/markSent/markFailed against the seeded
 * DB — the same code the deployed Worker runs. Deliberately does NOT import
 * ScheduleModule.forRoot() or the full WorkerModule (AuditConsumer/SQS,
 * ReportingModule, etc.): the @Cron decorators on relay() then have no
 * scheduler to register against, so nothing fires on its own timer — tests
 * call `.relay()` directly for deterministic, race-free assertions instead of
 * waiting on/racing the live 5s cron.
 */
export async function bootRallyWorkerRelays(): Promise<{
  module: TestingModule;
  notificationRelay: NotificationRelayService;
  emailRelay: EmailRelayService;
}> {
  const module = await Test.createTestingModule({
    imports: [PlatformModule, NotificationsModule],
    providers: [NotificationRelayService, EmailRelayService],
  }).compile();

  // onModuleInit (Valkey wake-signal subscription) still runs via init().
  await module.init();

  return {
    module,
    notificationRelay: module.get(NotificationRelayService),
    emailRelay: module.get(EmailRelayService),
  };
}

/**
 * Build a `JwtPayload` actor exactly as the auth guard would after minting an
 * access token. The application services read only `sub`, `workspaceId` and
 * `permissions`; the remaining JWT fields are inert values so the shape
 * type-checks.
 */
export function makeActor(userId: string, permissions: string[] = []): JwtPayload {
  return {
    sub: userId,
    contextId: WORKSPACE_ID,
    workspaceId: WORKSPACE_ID,
    permissions,
    claims: { permissions },
    sessionId: 'e2e-session',
    jti: 'e2e-jti',
    iss: 'rally-e2e',
    aud: 'rally',
    iat: 0,
    exp: 0,
    authMethod: 'sso',
  };
}

/** Workspace-admin actor: `workspace:*` grants every permission via the fast path. */
export const adminActor = (): JwtPayload => makeActor(ADMIN_USER_ID, ['workspace:*']);

/**
 * Read-only actor. Empty token permissions force `assertProjectPermission` to
 * fall back to the store, where VIEWER_ID resolves to `project_viewer`
 * (grants `work_item:view` but NOT `work_item:create` / `work_item:edit`).
 */
export const viewerActor = (): JwtPayload => makeActor(VIEWER_ID, []);

/**
 * Unique, uppercase project/team key (≤10 chars — the DB column is
 * `varchar(10)`) so repeated runs against the same seeded DB never collide with
 * a `*_KEY_TAKEN` conflict.
 *
 * The previous implementation was `Date.now().toString(36).slice(-5)` plus a
 * two-digit random, and did NOT hold that promise:
 *   - only 100 random values, so two keys minted in the same millisecond
 *     collided 1 in 100
 *   - the last 5 base36 chars of a ms timestamp wrap every 36^5 ms (~16.8 h),
 *     so the time component REPEATS
 * E2E rows are never cleaned up, so collision pressure grew with every run.
 * It surfaced as an unrelated-looking failure — a project insert dying on
 * uq_projects_workspace_key deep inside a notification test.
 *
 * Now 9 random hex chars after the prefix letter: 16^9 ≈ 6.9e10 values, no time
 * component to wrap. Key format is `^[A-Za-z][A-Za-z0-9]*$`, so hex is valid,
 * and 1 + 9 = 10 exactly fills varchar(10).
 */
export function uniqueKey(prefix = 'E'): string {
  const rand = randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase();
  return `${prefix}${rand}`;
}

/** Paging args that fetch everything a small test project produces. */
export const ALL = { limit: 200, cursor: null } as const;
