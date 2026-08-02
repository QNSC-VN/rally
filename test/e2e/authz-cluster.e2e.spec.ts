/**
 * Four authorization boundaries, over REAL HTTP, with the roles that actually hit them.
 *
 * All four were found by auditing the BA's Phase 0/2/4 SRS against the code, and all four were
 * invisible in testing for the same reason: the dev principal is a Workspace Admin, whose
 * `workspace:*` grant is the global anchor. That is exactly how the `report:view` bug survived to
 * migration 0092, so these assertions name the ROLE rather than trusting a convenient session.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService, EntraTokenVerifier, type EntraClaims } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/api/src/app.module';
import { NXP_ITER_CURRENT_ID, WORKSPACE_ID } from '../../db/seeds/constants';

describe('authorization cluster (e2e)', () => {
  let app: NestFastifyApplication;
  let auth: AuthService;

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
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Bearer, not the BFF cookie: Bearer callers are CSRF-exempt by design. */
  async function tokenFor(email: string): Promise<string> {
    const { accessToken } = await auth.devLogin(email, '127.0.0.1');
    expect(accessToken, `dev-login for ${email}`).toBeTruthy();
    return accessToken;
  }

  function get(url: string, token: string) {
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  }

  function post(url: string, token: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  }

  it('lets a Project Member open a work item by KEY', async () => {
    /**
     * `GET /work-items/by-key` carried `workspace:view`, which only `workspace_admin` holds
     * (`workspace:*` is admin-reserved). Neither Project Admin nor Project Member has any
     * `workspace:*` code — and this route is the SOLE resolver behind `/item/$itemKey`, so every
     * notification click and every ID cell answered 403 for the two roles that do the work.
     *
     * The service already resolves the row and then asserts `work_item:view` on its OWN project,
     * which is the check that belongs here; the outer gate was denying what the inner one allowed.
     */
    const member = await tokenFor('dev@qnsc.dev');
    const response = await get('/work-items/by-key?itemKey=US-1', member);
    expect(response.statusCode, response.body).toBe(200);
  });

  it('did not make the by-key route anonymous', async () => {
    /**
     * The by-key route now carries no `@RequirePermission` (the owning project is unknown until the
     * row is loaded, so `getWorkItemByKey` resolves it and then asserts `work_item:view` on that
     * project). This pins the thing that would make that a mistake: authentication must still be
     * required, so dropping the decorator cannot have opened the route.
     *
     * The DENY direction is deliberately not asserted with a role here: every seeded principal holds
     * `work_item:view` — `viewer@qnsc.dev` has it at WORKSPACE scope through `e2e_read_only` — so a
     * 403 case would need a fixture invented for this test, and a fabricated principal proves less
     * than the real inner assertion it would be standing in for.
     */
    const anonymous = await app.inject({ method: 'GET', url: '/work-items/by-key?itemKey=US-1' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('lets a Project Member add an item to an iteration', async () => {
    /**
     * `POST /iterations/:id/work-items` required `iteration:edit`, which a Project Member does not
     * hold, while the Add New button is gated client-side on `work_item:create`, which they do. So
     * they saw the button, filled the modal and got a 403 — for an item they can create from the
     * Backlog. The Iteration Status SRS assigns this `work_item:create`.
     */
    const member = await tokenFor('dev@qnsc.dev');
    const response = await post(`/iterations/${NXP_ITER_CURRENT_ID}/work-items`, member, {
      type: 'story',
      title: `Authz cluster story ${Date.now()}`,
    });
    expect(response.statusCode, response.body).toBe(201);
  });

  it('closes the two workspace reads that were open to every member', async () => {
    /**
     * Neither carried `@RequirePermission`, and a route with no metadata is OPEN — so any
     * authenticated member could read the workspace's configuration and the pending-hire roster
     * (address plus assigned role), while both WRITE paths were correctly gated. The SRS reserves
     * both surfaces for Workspace Admin.
     */
    const member = await tokenFor('dev@qnsc.dev');
    const admin = await tokenFor('admin@qnsc.dev');

    for (const url of [
      `/workspaces/${WORKSPACE_ID}/settings`,
      `/workspaces/${WORKSPACE_ID}/invitations`,
    ]) {
      expect((await get(url, member)).statusCode, `${url} must be refused`).toBe(403);
      expect((await get(url, admin)).statusCode, `${url} for an admin`).toBe(200);
    }
  });
});
