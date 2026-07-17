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
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { JwtPayload } from '@platform';

import { AppModule } from '../../../apps/api/src/app.module';

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
 */
export function uniqueKey(prefix = 'E'): string {
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  const rand = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0');
  return `${prefix}${stamp}${rand}`;
}

/** Paging args that fetch everything a small test project produces. */
export const ALL = { limit: 200, cursor: null } as const;
