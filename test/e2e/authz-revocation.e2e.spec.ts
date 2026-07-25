/**
 * End-to-end proof that a permission change takes effect on the user's NEXT
 * request instead of when their access token expires.
 *
 * Flow: none. Authorization infrastructure, like `sso-rbac.e2e.spec.ts` — it
 * underpins every business flow but proves no single one. Recorded explicitly so
 * the coverage matrix can tell "deliberately not a flow" from "untraced".
 *
 * The defect this pins: `PermissionGuard` authorizes from `claims.permissions`,
 * a snapshot embedded at mint time, and nothing invalidated it. Revoking a role
 * updated the database while the already-issued token kept working for up to
 * `JWT_ACCESS_EXPIRY` (15 minutes). The fix stamps an authorization epoch into
 * every token and bumps it on every baseline permission change, so a superseded
 * token is rejected with `TOKEN_STALE` and the client refreshes.
 *
 * This boots the REAL `AppModule` (real Nest DI, real Drizzle against the seeded
 * `rally-postgres`, real Valkey) and drives REAL HTTP requests through
 * `app.inject()`, so the JwtAuthGuard, the epoch lookup, and the route all run
 * exactly as in production. The ONLY stub is the Microsoft signature check
 * (`EntraTokenVerifier.verify`), which cannot be satisfied locally.
 *
 * Prereqs: docker deps up (`docker compose -f docker-compose.dev.yml up -d`) and
 * the DB seeded (`pnpm db:seed`).
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService, EntraTokenVerifier, type EntraClaims } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessService } from '@modules/access';
import { AuthzEpochService } from '@platform';
import type { JwtPayload } from '@platform';
import { AppModule } from '../../apps/api/src/app.module';

const TENANT = process.env['ENTRA_TENANT_ID'] ?? 'dev-tenant';
const DOMAIN = (process.env['SSO_ALLOWED_EMAIL_DOMAINS'] ?? 'qnsc.vn').split(',')[0].trim();

/**
 * Any authenticated route works as a probe; this one is `@Auth()` with no
 * permission requirement and no path params, so a failure can only come from the
 * guard chain — which is what's under test.
 */
const PROBE_ROUTE = '/notifications/unread-count';

/**
 * Seeded `workspace_admin` (see db/seeds/seed.ts). Used as the acting admin for
 * the role mutations below — `granted_by` is a real uuid column, so a synthetic
 * string id fails the insert.
 */
const SEEDED_ADMIN_ID = '00000000-0000-7000-8000-000000000002';

interface DecodedAccessToken {
  sub: string;
  contextId: string | null;
  claims: { permissions: string[]; authzEpoch?: number };
}

function decodeAccessToken(token: string): DecodedAccessToken {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DecodedAccessToken;
}

describe('Permission revocation takes effect on the next request (real AppModule)', () => {
  let app: NestFastifyApplication;
  let auth: AuthService;
  let access: AccessService;
  let epochs: AuthzEpochService;

  /** Log in a brand-new JIT-provisioned SSO user, so each test owns its principal. */
  async function loginFreshUser() {
    const claims: EntraClaims = {
      oid: `e2e-authz-${randomUUID()}`,
      email: `authz-e2e-${randomUUID().slice(0, 8)}@${DOMAIN}`,
      displayName: 'E2E Authz Epoch User',
      externalTenantId: TENANT,
      roles: [],
    };
    const result = await auth.ssoLogin(JSON.stringify(claims), '127.0.0.1');
    return { result, token: decodeAccessToken(result.accessToken) };
  }

  function probe(accessToken: string) {
    return app.inject({
      method: 'GET',
      url: PROBE_ROUTE,
      headers: { authorization: `Bearer ${accessToken}` },
    });
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
    // inject() drives the real Fastify router, which must be ready first.
    await app.getHttpAdapter().getInstance().ready();

    auth = app.get(AuthService);
    access = app.get(AccessService);
    epochs = app.get(AuthzEpochService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('stamps the authorization epoch the permissions were resolved at', async () => {
    const { token } = await loginFreshUser();
    const current = await epochs.current(token.sub);

    expect(token.claims.authzEpoch).toBe(current ?? 0);
  });

  it('rejects an access token whose permissions were superseded, and accepts it again after refresh', async () => {
    const { result, token } = await loginFreshUser();

    // 1. The freshly-minted token works.
    expect((await probe(result.accessToken)).statusCode).toBe(200);

    // 2. A baseline permission change lands — this is the admin action that used
    //    to leave the old snapshot effective for up to JWT_ACCESS_EXPIRY.
    await access.elevateToWorkspaceAdmin(token.sub, token.contextId!);

    // 3. The SAME token is now rejected on the very next request. Before the fix
    //    this assertion returned 200 for another ~15 minutes.
    const stale = await probe(result.accessToken);
    expect(stale.statusCode).toBe(401);
    expect(stale.body).toContain('TOKEN_STALE');

    // 4. Refreshing mints a token at the new epoch, and the client recovers
    //    without the user re-authenticating.
    const refreshed = await auth.refresh(result.refreshToken, result.csrfToken, '127.0.0.1');
    expect((await probe(refreshed.accessToken)).statusCode).toBe(200);

    // 5. The recovered token reflects the change that caused the rejection.
    const after = decodeAccessToken(refreshed.accessToken);
    expect(after.claims.permissions).toContain('workspace:*');
    expect(after.claims.authzEpoch).toBe(await epochs.current(token.sub));
  });

  it('rejects the token of a user whose workspace-scoped role was revoked', async () => {
    const { result, token } = await loginFreshUser();
    expect((await probe(result.accessToken)).statusCode).toBe(200);

    // Revoke the workspace-scoped assignment JIT provisioning granted. The actor
    // is the seeded workspace admin — this spec proves the revocation's effect on
    // the victim's token, not the admin's own authorization (covered by sso-rbac).
    const actor = {
      sub: SEEDED_ADMIN_ID,
      workspaceId: token.contextId!,
    } as unknown as JwtPayload;
    const assignments = await access.getUserAssignments(token.contextId!, token.sub);
    const baseline = assignments.find((a) => a.scopeType === 'workspace');
    expect(baseline).toBeDefined();

    await access.revokeRole(actor, baseline!.id);

    const stale = await probe(result.accessToken);
    expect(stale.statusCode).toBe(401);
    expect(stale.body).toContain('TOKEN_STALE');
  });

  it('leaves tokens alone when only a PROJECT-scoped assignment changes', async () => {
    // Project-tier permissions are resolved from the database per request, never
    // embedded in the token, so bumping the epoch for them would force a
    // needless re-mint on every project membership edit.
    const { result, token } = await loginFreshUser();
    const before = await epochs.current(token.sub);

    const roles = await access.listRoles(token.contextId!);
    const projectRole = roles.find((r) => r.slug === 'project_admin');
    expect(projectRole).toBeDefined();

    const actor = {
      sub: SEEDED_ADMIN_ID,
      workspaceId: token.contextId!,
    } as unknown as JwtPayload;
    await access.assignRole(actor, token.sub, projectRole!.id, 'project', randomUUID());

    expect(await epochs.current(token.sub)).toBe(before);
    expect((await probe(result.accessToken)).statusCode).toBe(200);
  });
});
