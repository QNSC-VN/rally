/**
 * End-to-end proof of the SSO login → RBAC/PBAC pipeline.
 *
 * This boots the REAL rally `AppModule` (real Nest DI, real Drizzle against the
 * seeded `rally-postgres`) and drives the REAL `@qnsc-vn/identity` `AuthService`.
 * The ONLY thing stubbed is the Entra token signature check
 * (`EntraTokenVerifier.verify`) — we cannot mint a Microsoft-signed JWT locally,
 * so the stub returns the `EntraClaims` a genuine verified token would yield.
 * Everything downstream of verification — JIT provisioning, workspace
 * enrolment, default-role assignment, platform-admin elevation, claims
 * resolution and access-token minting — runs exactly as it does in production.
 *
 * What it proves:
 *  1. A brand-new corporate-domain SSO user is JIT-provisioned and lands as
 *     `project_member`, and the PBAC permissions embedded in the minted access
 *     token EXACTLY match what `AccessService` resolves for that user+workspace.
 *  2. A user whose email is in `PLATFORM_ADMIN_EMAILS` is elevated to
 *     `workspace_admin` on SSO login and their token carries `workspace:*`.
 *  3. The two are correctly differentiated (member has no `workspace:*`).
 *
 * Prereqs: docker deps up (`docker compose -f docker-compose.dev.yml up -d`) and
 * the DB seeded (`pnpm db:seed`). Config is read from `.env` by @nestjs/config,
 * so the test runs against the same connection/tenant the dev server uses.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService, EntraTokenVerifier, type EntraClaims } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessService } from '@modules/access';
import { AppModule } from '../../apps/api/src/app.module';

// Read from the SAME environment the seed used, so the test matches whatever
// this machine bootstrapped rather than one hard-coded environment.
//
// These were previously literals ('dev-tenant' / 'nghiavt@qnsc.vn'), which meant
// the spec only passed where those exact values happened to be configured — CI.
// Locally, .env seeds a different tenant and admin, so both cases failed with
// "No workspace is configured for your organization" and a project_member/
// workspace_admin mismatch: a config mismatch that reads exactly like a product
// bug. The header even claimed config came from .env while the code ignored it.
//
// seedTenantBootstrap creates the SSO connection from ENTRA_TENANT_ID, and the
// platform-admin elevation reads PLATFORM_ADMIN_EMAILS, so deriving both from
// the same source keeps the test aligned by construction.
const TENANT = process.env['ENTRA_TENANT_ID'] ?? 'dev-tenant';
const PLATFORM_ADMIN_EMAIL = (process.env['PLATFORM_ADMIN_EMAILS'] ?? 'nghiavt@qnsc.vn')
  .split(',')[0]
  .trim();
// JIT provisioning is gated on the connection's allow-list, which
// seedTenantBootstrap builds from SSO_ALLOWED_EMAIL_DOMAINS — not from the admin
// address. Deriving it from the admin email instead would happen to pass while
// asserting the wrong thing.
const DOMAIN = (process.env['SSO_ALLOWED_EMAIL_DOMAINS'] ?? 'qnsc.vn').split(',')[0].trim();
const WORKSPACE_ALL = 'workspace:*';

interface DecodedAccessToken {
  sub: string;
  contextId: string | null;
  authMethod: 'password' | 'sso';
  claims: { permissions: string[] };
}

/** Decode a JWT payload without verifying — we only read the claims we minted. */
function decodeAccessToken(token: string): DecodedAccessToken {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DecodedAccessToken;
}

/** Build the fake "verified" Entra token: the stub verifier just JSON-parses it. */
function entraToken(claims: EntraClaims): string {
  return JSON.stringify(claims);
}

describe('SSO login → RBAC/PBAC (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let auth: AuthService;
  let access: AccessService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Replace ONLY the Microsoft signature check. Everything else is real.
      .overrideProvider(EntraTokenVerifier)
      .useValue({
        verify: async (idToken: string): Promise<EntraClaims> => JSON.parse(idToken) as EntraClaims,
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // init() runs onModuleInit lifecycle (DB pool, cache) without binding a port.
    await app.init();

    auth = app.get(AuthService);
    access = app.get(AccessService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('JIT-provisions a corporate SSO user as project_member with token PBAC matching the store', async () => {
    const claims: EntraClaims = {
      oid: 'e2e-sso-regular',
      email: `sso-e2e-regular@${DOMAIN}`,
      displayName: 'E2E Regular SSO User',
      externalTenantId: TENANT,
      roles: [],
    };

    const result = await auth.ssoLogin(entraToken(claims), '127.0.0.1');
    const token = decodeAccessToken(result.accessToken);

    // Minted via the SSO path, scoped to a real workspace.
    expect(token.authMethod).toBe('sso');
    expect(token.contextId).toEqual(expect.any(String));

    // PBAC is present and non-empty.
    expect(Array.isArray(token.claims.permissions)).toBe(true);
    expect(token.claims.permissions.length).toBeGreaterThan(0);

    // The permissions baked into the token must EXACTLY equal what the access
    // store resolves for this user in this workspace — no drift between the
    // login-time snapshot and the source of truth.
    const resolved = await access.getUserRoleAndPermissions(token.sub, token.contextId!);
    expect(resolved.role).toBe('project_member');
    expect([...token.claims.permissions].sort()).toEqual([...resolved.permissions].sort());

    // A plain member is NOT a workspace admin.
    expect(token.claims.permissions).not.toContain(WORKSPACE_ALL);
  });

  it('elevates a PLATFORM_ADMIN_EMAILS user to workspace_admin (token carries workspace:*)', async () => {
    const claims: EntraClaims = {
      oid: 'e2e-sso-admin',
      email: PLATFORM_ADMIN_EMAIL,
      displayName: 'E2E Platform Admin',
      externalTenantId: TENANT,
      roles: [],
    };

    const result = await auth.ssoLogin(entraToken(claims), '127.0.0.1');
    const token = decodeAccessToken(result.accessToken);

    const resolved = await access.getUserRoleAndPermissions(token.sub, token.contextId!);
    expect(resolved.role).toBe('workspace_admin');

    // workspace_admin carries the `workspace:*` wildcard, both in the store and
    // in the freshly minted token.
    expect(resolved.permissions).toContain(WORKSPACE_ALL);
    expect(token.claims.permissions).toContain(WORKSPACE_ALL);
  });
});
