/**
 * API tokens over REAL HTTP: minting, authenticating with one, scope narrowing, and the two refusals
 * that keep a leaked token from becoming a credential factory.
 *
 * Why e2e and not a service spec. Everything load-bearing here lives in the guard chain — the platform
 * guard recognising an opaque token by its prefix, `PolicyGuard` intersecting scopes with the
 * database-resolved permissions, and `RejectApiTokenAuthGuard` refusing token-authenticated writes. A
 * spec that called `ApiTokensService` directly would pass with every one of those broken, which is the
 * exact blind spot CLAUDE.md records for the task-routes and report-authz defects.
 *
 * `/audit-logs` is the probe route, as in `authz-revocation.e2e.spec.ts`: one workspace-tier permission
 * (`audit:view`), held by Workspace Admin, no query parameters to get wrong. The ValidationPipe runs
 * BEFORE the guard, so a route needing arguments would answer 400 and never reach authorization.
 *
 * No `/v1` prefix: `Test.createTestingModule` builds the app without the bootstrap that sets it.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService, EntraTokenVerifier, type EntraClaims } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/api/src/app.module';

const PROBE_ROUTE = '/audit-logs';
const ADMIN_EMAIL = 'admin@qnsc.dev';
const VIEWER_EMAIL = 'viewer@qnsc.dev';

describe('API tokens over HTTP (e2e)', () => {
  let app: NestFastifyApplication;
  let auth: AuthService;

  /** Bearer JWT for a seeded user. `devLogin` for the reason report-authz documents: no cookie plugin. */
  async function tokenFor(email: string): Promise<string> {
    const result = await auth.devLogin(email, '127.0.0.1');
    expect(result.accessToken, `dev-login for ${email}`).toBeTruthy();
    return result.accessToken;
  }

  function withAuth(credential: string) {
    return {
      get: (url: string) =>
        app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${credential}` } }),
      post: (url: string, payload: Record<string, unknown>) =>
        app.inject({
          method: 'POST',
          url,
          headers: { authorization: `Bearer ${credential}` },
          payload,
        }),
      delete: (url: string) =>
        app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${credential}` } }),
    };
  }

  async function mint(
    sessionToken: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; token: string }> {
    const response = await withAuth(sessionToken).post('/me/api-tokens', body);
    expect(response.statusCode, response.body).toBe(201);
    const created = JSON.parse(response.body) as { id: string; token: string };
    return created;
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('mints a token, returns the credential ONCE, and authenticates with it', async () => {
    const session = await tokenFor(ADMIN_EMAIL);
    const created = await mint(session, { name: 'e2e full' });

    expect(created.token.startsWith('rly_')).toBe(true);

    // The credential works on a route the owner is permitted to call.
    const probe = await withAuth(created.token).get(PROBE_ROUTE);
    expect(probe.statusCode, probe.body).toBe(200);

    // And it is never retrievable again: the list carries the prefix, never the token.
    const list = await withAuth(session).get('/me/api-tokens');
    expect(list.statusCode).toBe(200);
    const rows = JSON.parse(list.body) as Array<Record<string, unknown>>;
    const mine = rows.find((row) => row.id === created.id);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty('token');
    expect(mine).not.toHaveProperty('tokenHash');
    expect(String(mine!.prefix)).toBe(created.token.slice(0, 12));
  });

  it('NARROWS to its scopes — the owner may, the token may not', async () => {
    // The admin holds `workspace:*`, so this is the case an array intersection would get wrong: there
    // is no literal overlap between `workspace:*` and the scope, and the token must still work for
    // what it was scoped to and refuse everything else.
    const session = await tokenFor(ADMIN_EMAIL);
    const scoped = await mint(session, { name: 'e2e scoped', scopes: ['work_item:view'] });

    const refused = await withAuth(scoped.token).get(PROBE_ROUTE);
    expect(refused.statusCode, refused.body).toBe(403);

    // Same principal, same route, no token: permitted. So the refusal is the scope, not the grant.
    const permitted = await withAuth(session).get(PROBE_ROUTE);
    expect(permitted.statusCode).toBe(200);
  });

  it('refuses a scope its owner does not hold, at mint time', async () => {
    // Where the mistake was made. At use time an unknown code and a permission the user lacks are
    // indistinguishable — both narrow to nothing and both read as a 403 on an unrelated request.
    const session = await tokenFor(ADMIN_EMAIL);
    const response = await withAuth(session).post('/me/api-tokens', {
      name: 'typo',
      scopes: ['work_item:viewww'],
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('work_item:viewww');
  });

  it('will not let a token mint or revoke tokens', async () => {
    // Without this a leaked token is a credential factory: mint a fresh one, and revoking the one you
    // found changes nothing.
    const session = await tokenFor(ADMIN_EMAIL);
    const created = await mint(session, { name: 'e2e escalation' });

    const mintAttempt = await withAuth(created.token).post('/me/api-tokens', { name: 'child' });
    expect(mintAttempt.statusCode).toBe(403);
    expect(mintAttempt.body).toContain('API_TOKEN_CANNOT_MANAGE_TOKENS');

    const listAttempt = await withAuth(created.token).get('/me/api-tokens');
    expect(listAttempt.statusCode).toBe(403);

    const revokeAttempt = await withAuth(created.token).delete(`/me/api-tokens/${created.id}`);
    expect(revokeAttempt.statusCode).toBe(403);
  });

  it('stops working the moment it is revoked', async () => {
    const session = await tokenFor(ADMIN_EMAIL);
    const created = await mint(session, { name: 'e2e revoke' });
    expect((await withAuth(created.token).get(PROBE_ROUTE)).statusCode).toBe(200);

    const revoked = await withAuth(session).delete(`/me/api-tokens/${created.id}`);
    expect(revoked.statusCode).toBe(204);

    // 401, not 403: the credential is no longer valid at all, which is a different fact from being
    // insufficiently permitted, and the two must not be confused when someone is debugging an outage.
    const after = await withAuth(created.token).get(PROBE_ROUTE);
    expect(after.statusCode, after.body).toBe(401);
  });

  it('rejects a forged token whose prefix is real', async () => {
    // The prefix is an index, not a credential. A lookup that skipped the hash comparison would pass.
    const session = await tokenFor(ADMIN_EMAIL);
    const created = await mint(session, { name: 'e2e forged' });
    const forged = `${created.token.slice(0, 12)}${'A'.repeat(created.token.length - 12)}`;

    const response = await withAuth(forged).get(PROBE_ROUTE);
    expect(response.statusCode).toBe(401);
  });

  it('keeps the administrator view behind api_token:manage_all', async () => {
    // The offboarding question — "what still has access" — is an administrator capability. A member
    // must not be able to enumerate, or revoke, everyone else's integrations.
    const admin = await tokenFor(ADMIN_EMAIL);
    const viewer = await tokenFor(VIEWER_EMAIL);
    const created = await mint(admin, { name: 'e2e admin view' });

    const refused = await withAuth(viewer).get('/api-tokens');
    expect(refused.statusCode, refused.body).toBe(403);

    const allowed = await withAuth(admin).get('/api-tokens');
    expect(allowed.statusCode, allowed.body).toBe(200);
    const rows = JSON.parse(allowed.body) as Array<{ id: string }>;
    expect(rows.some((row) => row.id === created.id)).toBe(true);

    const viewerRevoke = await withAuth(viewer).delete(`/api-tokens/${created.id}`);
    expect(viewerRevoke.statusCode).toBe(403);

    const adminRevoke = await withAuth(admin).delete(`/api-tokens/${created.id}`);
    expect(adminRevoke.statusCode).toBe(204);
  });

  it("reports another user's token as not found rather than forbidden", async () => {
    // A 403 would confirm the id exists, which is what an enumeration attempt is looking for.
    const admin = await tokenFor(ADMIN_EMAIL);
    const viewer = await tokenFor(VIEWER_EMAIL);
    const created = await mint(admin, { name: 'e2e ownership' });

    const response = await withAuth(viewer).delete(`/me/api-tokens/${created.id}`);
    expect(response.statusCode).toBe(404);
  });
});
