/**
 * The five report routes, over REAL HTTP, proving `report:view` actually denies.
 *
 * The gap this closes: every existing reporting assertion calls `ReportingService` directly as a
 * workspace admin. The decorators on `reporting.controller.ts` were therefore proven only to EXIST —
 * `test/route-policy.ratchet.spec.ts` counts undecorated handlers by reading source text, which cannot
 * tell a correct `@RequirePermission` from a misspelled one, a wrong code, or a project-tier code
 * whose scope resolves from the wrong field.
 *
 * That mattered: `report:view` reached the catalogue in Phase 6 but never reached an existing
 * workspace's tier roles (`db/seeds/bootstrap.ts` upserts them with `set: { name }`), so every report
 * answered 403 to everyone except Workspace Admin — whose `workspace:*` grant is the global anchor and
 * hid it in every test. Migration 0092 fixed the data; this proves the boundary itself, in both
 * directions, on the only surface a browser can reach.
 *
 * Boots the REAL `AppModule` and drives `app.inject()`, so the guard chain, the cached permission
 * resolution and the route all run as in production. The one stub is the Microsoft signature check,
 * which cannot be satisfied locally.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService, EntraTokenVerifier, type EntraClaims } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccessService } from '@modules/access';
import type { JwtPayload } from '@platform';
import { AppModule } from '../../apps/api/src/app.module';
import {
  NXP_ITER_CURRENT_ID,
  NXP_RELEASE_1_ID,
  SEED_PROJECTS,
  VIEWER_ID,
  WORKSPACE_ID,
} from '../../db/seeds/constants';

const TENANT = process.env['ENTRA_TENANT_ID'] ?? 'dev-tenant';
const DOMAIN = (process.env['SSO_ALLOWED_EMAIL_DOMAINS'] ?? 'qnsc.vn').split(',')[0].trim();
const SEEDED_ADMIN_ID = '00000000-0000-7000-8000-000000000002';
const NXP = SEED_PROJECTS[0].id;
const ITERATION = NXP_ITER_CURRENT_ID;
const RELEASE = NXP_RELEASE_1_ID;

/**
 * Every reporting route, each with a FULLY VALID query.
 *
 * All five are listed deliberately rather than one as a sample: they carry the decorator
 * independently, and a route added without one is OPEN (`PolicyGuard` returns true when it finds no
 * metadata).
 *
 * The queries are complete because the VALIDATION PIPE runs before the guard — an incomplete query
 * returns 400 and the request never reaches authorization at all, so it would prove nothing. Found by
 * asserting 403 and getting 400. Both ids come from the seeded fixture, so a valid request is also a
 * request that can genuinely succeed once the grant exists.
 */
const ROUTES = [
  `/reports/iteration-burndown?projectId=${NXP}&iterationId=${ITERATION}`,
  `/reports/velocity?projectId=${NXP}&window=5`,
  `/reports/team-capacity?projectId=${NXP}&iterationId=${ITERATION}`,
  `/reports/release-tracking?projectId=${NXP}&releaseId=${RELEASE}`,
  `/reports/release-tracking/burnup?projectId=${NXP}&releaseId=${RELEASE}`,
] as const;

// No `/v1` prefix: `Test.createTestingModule` builds the app WITHOUT the bootstrap that sets the
// global prefix, so the routes are mounted bare here. `authz-revocation.e2e.spec.ts` probes
// `/audit-logs` for the same reason. Getting this wrong reads as a 404 — which is exactly what a
// missing route and a refused one must never be confused for, and is why the assertions below
// distinguish 403 from everything else rather than asserting "not 200".

function decodeAccessToken(token: string): JwtPayload {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtPayload;
}

describe('report routes: authorization over HTTP (e2e)', () => {
  let app: NestFastifyApplication;
  let auth: AuthService;
  let access: AccessService;

  /**
   * Sign in as a SEEDED user and return a bearer token.
   *
   * `AuthService.devLogin` rather than the BFF route: the BFF sets a `__Host-` cookie via
   * `reply.setCookie`, and `Test.createTestingModule` builds the app without the bootstrap that
   * registers the cookie plugin — so that path 500s here with `reply.setCookie is not a function`.
   * The service returns the same tokens the controller would wrap, and it is hard-blocked when
   * `nodeEnv` is production, so it cannot become a backdoor.
   *
   * A seeded user rather than an SSO login, because `ssoLogin` JIT-provisions the default role — which
   * carries the very permission under test and would make the negative case impossible to express.
   */
  async function tokenFor(email: string): Promise<string> {
    const result = await auth.devLogin(email, '127.0.0.1');
    expect(result.accessToken, `dev-login for ${email}`).toBeTruthy();
    return result.accessToken;
  }

  function get(url: string, accessToken: string) {
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${accessToken}` } });
  }

  function actorFor(workspaceId: string): JwtPayload {
    return { sub: SEEDED_ADMIN_ID, workspaceId } as unknown as JwtPayload;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EntraTokenVerifier)
      .useValue({
        verify: async (idToken: string): Promise<EntraClaims> => JSON.parse(idToken) as EntraClaims,
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    auth = app.get(AuthService);
    access = app.get(AccessService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REFUSES every report route to a principal without report:view', async () => {
    /**
     * The boundary as it actually exists.
     *
     * A JIT-provisioned SSO user is NOT the denied case: `assignDefaultRole` grants
     * `project_member` at workspace scope, and the BA gives that role `report:view` — so every SSO
     * user can read reports by design. Asserting 403 for a fresh login got 200, correctly, and that
     * is worth stating rather than quietly working around: if reports should not be open to every
     * member, the catalogue is the thing to change, not this test.
     *
     * The seeded `viewer@qnsc.dev` is the real negative case: two custom roles, `project:view` and
     * `work_item:view` between them, and no default-role assignment.
     */
    const session = await tokenFor('viewer@qnsc.dev');

    for (const url of ROUTES) {
      const response = await get(url, session);
      // 403, not 401: the caller is authenticated and identified — it is the PERMISSION that is
      // missing. A 401 would mean the guard order regressed.
      expect(response.statusCode, `${url} must be refused`).toBe(403);
    }
  });

  it('ALLOWS them for a member whose role carries report:view', async () => {
    // `dev@qnsc.dev` holds the workspace-scoped `project_member` role — the row `PolicyGuard`
    // resolves, and the one migration 0092 had to backfill. Same routes, same queries, different
    // principal: the ONLY difference is the permission.
    const session = await tokenFor('dev@qnsc.dev');

    for (const url of ROUTES) {
      const response = await get(url, session);
      expect(response.statusCode, `${url} must be allowed`).toBe(200);
    }
  });

  it('refuses a project-scoped grant pointed at a DIFFERENT project', async () => {
    /**
     * `report:view` is project-tier, so the SCOPE has to be checked and not just the code. This
     * grants the viewer a role carrying `report:view` on a project that is not NXP; if the tier were
     * decorative, that would open NXP's reports too.
     */
    const roles = await access.listRoles(WORKSPACE_ID);
    const projectAdmin = roles.find((r) => r.slug === 'project_admin' && r.workspaceId !== null);
    expect(projectAdmin, 'workspace-scoped project_admin must exist').toBeDefined();
    expect(projectAdmin!.permissions).toContain('report:view');

    await access.assignRole(
      actorFor(WORKSPACE_ID),
      VIEWER_ID,
      projectAdmin!.id,
      'project',
      // A real grant whose scope simply is not NXP.
      randomUUID(),
    );

    const session = await tokenFor('viewer@qnsc.dev');
    for (const url of ROUTES) {
      expect((await get(url, session)).statusCode, `${url} cross-project`).toBe(403);
    }
  });
});
