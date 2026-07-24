/**
 * Multi-IdP OIDC broker — connection resolution, connection-driven provisioning,
 * and the disabled-connection cutoff, against the REAL rally AppModule + seeded
 * `rally-postgres`.
 *
 * The broker's expensive I/O (OIDC discovery + Secrets Manager) is exercised by
 * the package's unit tests; here we prove the parts that touch the real DB and
 * the real provisioning pipeline — which need no network because
 * `AuthService.ssoLoginFromConnection` takes the resolved connection ROW
 * directly (routing/verification already done upstream in production):
 *   1. the schema satisfies the package's connection CONTRACT;
 *   2. a `directory` connection is routed by its owned email domain (and unknown
 *      domains are denied);
 *   3. a `shared` connection is reachable only for an INVITED email;
 *   4. a federated user is JIT-provisioned into the RESOLVED connection's
 *      workspace + default role (never re-derived from claims);
 *   5. flipping a connection to `status='disabled'` denies login immediately.
 *
 * Prereqs: docker deps up + `pnpm db:seed` (+ migration 0057 applied), same as
 * the other e2e specs. Idempotent — fixed test tenants, upserted to `active` on
 * every run so a prior cutoff flip doesn't leak.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuthService,
  SSO_CONNECTION_REPOSITORY,
  assertConnectionContract,
  type ISsoConnectionRepository,
  type EntraClaims,
} from '@qnsc-vn/identity';
import { AccessService } from '@modules/access';
import { DRIZZLE, type DrizzleDB } from '@platform/database/drizzle.provider';
import { AppModule } from '../../apps/api/src/app.module';
import { ssoConnections, ssoConnectionDomains } from '../../db/schema/identity';
import { workspaceInvitations } from '../../db/schema/workspace';
import { WORKSPACE_ID, ADMIN_USER_ID } from './support/flow-harness';

const VENDOR_TID = 'e2e-mconn-vendor';
const CUTOFF_TID = 'e2e-mconn-cutoff';
const GOOGLE_TID = 'e2e-mconn-google';
const VENDOR_DOMAIN = 'vendor-e2e.test';
const CUTOFF_DOMAIN = 'cutoff-e2e.test';
const INVITED_EMAIL = 'guest@shared-e2e.test';

const BROKER = {
  authorityUrl: 'https://idp.example.test/x',
  clientId: 'e2e-cid',
  clientSecretRef: 'rally/test/sso/e2e',
} as const;

interface DecodedToken {
  authMethod: string;
  contextId: string | null;
  sub: string;
  claims: { permissions: string[] };
}

function decode(token: string): DecodedToken {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as DecodedToken;
}

describe('Multi-IdP broker: resolution, provisioning, cutoff (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let auth: AuthService;
  let access: AccessService;
  let repo: ISsoConnectionRepository;
  let db: DrizzleDB;

  async function upsertConnection(row: typeof ssoConnections.$inferInsert): Promise<void> {
    await db
      .insert(ssoConnections)
      .values(row)
      .onConflictDoUpdate({
        target: [ssoConnections.provider, ssoConnections.externalTenantId],
        set: {
          status: 'active',
          kind: row.kind,
          workspaceId: row.workspaceId,
          defaultRoleSlug: row.defaultRoleSlug,
          allowedEmailDomains: row.allowedEmailDomains,
          jitEnabled: row.jitEnabled,
          authorityUrl: row.authorityUrl,
          clientId: row.clientId,
          clientSecretRef: row.clientSecretRef,
          updatedAt: new Date(),
        },
      });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    auth = app.get(AuthService);
    access = app.get(AccessService);
    repo = app.get<ISsoConnectionRepository>(SSO_CONNECTION_REPOSITORY);
    db = app.get<DrizzleDB>(DRIZZLE);

    await upsertConnection({
      workspaceId: WORKSPACE_ID,
      provider: 'entra',
      externalTenantId: VENDOR_TID,
      kind: 'directory',
      defaultRoleSlug: 'project_member',
      allowedEmailDomains: [VENDOR_DOMAIN],
      jitEnabled: true,
      status: 'active',
      ...BROKER,
    });
    await upsertConnection({
      workspaceId: WORKSPACE_ID,
      provider: 'entra',
      externalTenantId: CUTOFF_TID,
      kind: 'directory',
      defaultRoleSlug: 'project_member',
      allowedEmailDomains: [CUTOFF_DOMAIN],
      jitEnabled: true,
      status: 'active',
      ...BROKER,
    });
    await upsertConnection({
      workspaceId: WORKSPACE_ID,
      provider: 'google',
      externalTenantId: GOOGLE_TID,
      kind: 'shared',
      defaultRoleSlug: 'project_member',
      allowedEmailDomains: [],
      jitEnabled: true,
      status: 'active',
      ...BROKER,
    });

    const vendor = await repo.findByExternalTenantId('entra', VENDOR_TID);
    const cutoff = await repo.findByExternalTenantId('entra', CUTOFF_TID);
    await db
      .insert(ssoConnectionDomains)
      .values([
        { connectionId: vendor!.id, domain: VENDOR_DOMAIN },
        { connectionId: cutoff!.id, domain: CUTOFF_DOMAIN },
      ])
      .onConflictDoNothing({ target: ssoConnectionDomains.domain });

    await db
      .insert(workspaceInvitations)
      .values({
        workspaceId: WORKSPACE_ID,
        email: INVITED_EMAIL,
        tokenHash: `e2e-mconn-${INVITED_EMAIL}`,
        invitedBy: ADMIN_USER_ID,
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .onConflictDoNothing({ target: workspaceInvitations.tokenHash });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the schema satisfies the broker connection contract', async () => {
    await expect(
      assertConnectionContract(async (table) => {
        const res = await db.execute(
          sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'identity' AND table_name = ${table}`,
        );
        const rows =
          (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows) ?? ([] as unknown[]);
        return (rows as { column_name: string }[]).map((c) => ({ column_name: c.column_name }));
      }),
    ).resolves.toBeUndefined();
  });

  it('routes a directory connection by its owned email domain; denies unknown', async () => {
    const hit = await repo.findDirectoryByEmailDomain(`someone@${VENDOR_DOMAIN}`);
    expect(hit?.externalTenantId).toBe(VENDOR_TID);
    expect(await repo.findDirectoryByEmailDomain('someone@nowhere-e2e.test')).toBeNull();
    expect(await repo.connectionOwnsEmailDomain(hit!.id, `x@${VENDOR_DOMAIN}`)).toBe(true);
    expect(await repo.connectionOwnsEmailDomain(hit!.id, 'x@other-e2e.test')).toBe(false);
  });

  it('routes a shared connection only for an invited email', async () => {
    const invited = await repo.findSharedByInvitedEmail(INVITED_EMAIL);
    expect(invited?.externalTenantId).toBe(GOOGLE_TID);
    expect(await repo.findSharedByInvitedEmail('uninvited@shared-e2e.test')).toBeNull();
  });

  it('provisions a federated user into the resolved connection workspace + role', async () => {
    const vendor = await repo.findByExternalTenantId('entra', VENDOR_TID);
    const claims: EntraClaims = {
      oid: 'e2e-mconn-vendor-user',
      email: `user@${VENDOR_DOMAIN}`,
      displayName: 'Vendor E2E User',
      externalTenantId: null,
      roles: [],
    };
    const result = await auth.ssoLoginFromConnection(vendor!, claims, '127.0.0.1');
    const token = decode(result.accessToken);

    expect(token.authMethod).toBe('sso');
    expect(token.contextId).toBe(WORKSPACE_ID);
    const resolved = await access.getUserRoleAndPermissions(token.sub, WORKSPACE_ID);
    expect(resolved.role).toBe('project_member');
  });

  it('denies login through a disabled connection (instant cutoff)', async () => {
    await db
      .update(ssoConnections)
      .set({ status: 'disabled' })
      .where(
        and(eq(ssoConnections.provider, 'entra'), eq(ssoConnections.externalTenantId, CUTOFF_TID)),
      );

    const disabled = await repo.findByExternalTenantId('entra', CUTOFF_TID); // findBy* has no status filter
    const claims: EntraClaims = {
      oid: 'e2e-mconn-cutoff-user',
      email: `user@${CUTOFF_DOMAIN}`,
      displayName: 'Cutoff E2E User',
      externalTenantId: null,
      roles: [],
    };
    await expect(auth.ssoLoginFromConnection(disabled!, claims, '127.0.0.1')).rejects.toMatchObject(
      {
        code: 'SSO_CONNECTION_DISABLED',
      },
    );
  });
});
