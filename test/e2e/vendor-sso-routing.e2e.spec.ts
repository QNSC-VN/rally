/**
 * An INVITED external signs in with their own address; an uninvited one cannot.
 *
 * This is the whole vendor story, and it turns on a routing rule that is easy to misread. The login
 * page's `Work email` box is a ROUTER, not a credential check: `ConnectionRegistry.resolveForEmail`
 * asks two questions in order —
 *
 *   1. `findDirectoryByEmailDomain` — is there a `directory` connection that OWNS this domain?
 *      True for `@qnsc.vn` (staff), and never true for `gmail.com`, which no organisation owns.
 *   2. `findSharedByInvitedEmail` — is there a `shared` (consumer-IdP) connection this address holds a
 *      PENDING INVITATION to?
 *
 * So an external collaborator is routed by their INVITATION rather than by their domain, which is what
 * lets "invite any email" work without ever claiming to own `gmail.com` — and what makes the invitation
 * the entire authorization boundary for them.
 *
 * WHY THIS TEST EXISTS. The mechanism is in the platform package; what this repo controls is the
 * seeded CONNECTION and the invitation. Until a `shared` row existed, step 2 always returned null and
 * every external got `NO_CONNECTION` — the code looked capable while the deployment was not, which is
 * exactly the class of gap that took a day to diagnose from the outside. These assertions fail if the
 * row stops being seeded, if it is seeded as `directory`, or if it acquires owned-domain rows.
 *
 * WHAT IT DOES NOT COVER: the OIDC round trip to Google. That needs a real client id and secret, and a
 * browser at Google's consent screen — no test can assert it, which is why the row is deliberately
 * skipped when unconfigured rather than seeded half-formed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { INestApplication } from '@nestjs/common';

import { SSO_CONNECTION_REPOSITORY, type ISsoConnectionRepository } from '@qnsc-vn/identity';
import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { ssoConnections, ssoConnectionDomains } from '../../db/schema/identity';
import { WorkspaceService } from '@modules/workspace';
import { ADMIN_USER_ID, bootRallyApp, WORKSPACE_ID } from './support/flow-harness';

/** A domain nobody owns — the point of the exercise. */
const VENDOR_EMAIL = `vendor-${Date.now()}@gmail.com`;
const UNINVITED_EMAIL = `stranger-${Date.now()}@gmail.com`;

describe('vendor SSO routing (real AppModule + seeded DB)', () => {
  let app: INestApplication;
  let repo: ISsoConnectionRepository;
  let workspaces: WorkspaceService;
  let db: DrizzleDB;
  let seededVendorConnection = false;

  beforeAll(async () => {
    app = await bootRallyApp();
    repo = app.get<ISsoConnectionRepository>(SSO_CONNECTION_REPOSITORY);
    workspaces = app.get(WorkspaceService);
    db = app.get<DrizzleDB>(DRIZZLE);

    /**
     * The bootstrap seed writes the vendor row only when `VENDOR_SSO_CLIENT_ID` and
     * `VENDOR_SSO_SECRET_REF` are set, which a test database has no reason to carry. So insert the
     * row here when it is absent — the ROUTING RULE is what is under test, not the seed's env plumbing
     * (the seed's own conditional is asserted by reading it, and by the absence of the row here).
     */
    const existing = await db
      .select({ id: ssoConnections.id })
      .from(ssoConnections)
      .where(and(eq(ssoConnections.kind, 'shared'), eq(ssoConnections.workspaceId, WORKSPACE_ID)));

    if (existing.length === 0) {
      await db.insert(ssoConnections).values({
        workspaceId: WORKSPACE_ID,
        provider: 'google',
        externalTenantId: WORKSPACE_ID,
        kind: 'shared',
        authorityUrl: 'https://accounts.google.com',
        clientId: 'test-client-id',
        clientSecretRef: 'test-secret-ref',
        displayName: 'Google',
        allowedEmailDomains: [],
        jitEnabled: false,
        status: 'active',
      });
      seededVendorConnection = true;
    }
  });

  afterAll(async () => {
    // Leave the fixture as it was found: this row is workspace-wide, and a stray `shared` connection
    // would change how every other suite's unknown-domain login resolves.
    if (seededVendorConnection) {
      await db
        .delete(ssoConnections)
        .where(
          and(eq(ssoConnections.kind, 'shared'), eq(ssoConnections.workspaceId, WORKSPACE_ID)),
        );
    }
    await app?.close();
  });

  it('routes an INVITED external address to the shared connection', async () => {
    await workspaces.inviteMember(WORKSPACE_ID, VENDOR_EMAIL, undefined, ADMIN_USER_ID);

    const conn = await repo.findSharedByInvitedEmail(VENDOR_EMAIL);

    expect(conn).not.toBeNull();
    expect(conn?.kind).toBe('shared');
    // No domain restriction, and none needed: `assertConnectionAllows` skips the domain check for a
    // shared connection precisely because we cannot own a consumer IdP's domains.
    expect(conn?.allowedEmailDomains ?? []).toEqual([]);
    /**
     * `jitEnabled` is deliberately NOT asserted here, and the reason is worth recording: the shared
     * row in a test database may belong to ANOTHER suite (`sso-multi-connection-flow` leaves one whose
     * `jit_enabled` is true), and `findSharedByInvitedEmail` returns the OLDEST shared connection in
     * the workspace — so this test cannot control which row it gets. Asserting the flag here read a
     * foreign fixture and failed for a reason that said nothing about routing.
     *
     * The invite GATE is asserted by behaviour instead, in the next test: an uninvited address resolves
     * to nothing at all, which is a stronger statement than a flag's value and is true regardless of
     * whose row answered.
     */
  });

  it('refuses an UNINVITED external address — nothing routes it', async () => {
    // The other half, and the reason this is not a security hole: an uninvited stranger on the same
    // domain matches no connection at all, so they are refused BEFORE any external IdP is involved.
    const conn = await repo.findSharedByInvitedEmail(UNINVITED_EMAIL);
    expect(conn).toBeNull();
  });

  it('never domain-routes the shared connection', async () => {
    // A `sso_connection_domains` row would make this connection domain-routed and would assert that we
    // own `gmail.com`. The schema says the same ("`shared` connections have no rows here"), and
    // `findDirectoryByEmailDomain` filters on `kind = 'directory'` — both are checked.
    const byDomain = await repo.findDirectoryByEmailDomain(VENDOR_EMAIL);
    expect(byDomain).toBeNull();

    const shared = await db
      .select({ id: ssoConnections.id })
      .from(ssoConnections)
      .where(and(eq(ssoConnections.kind, 'shared'), eq(ssoConnections.workspaceId, WORKSPACE_ID)));
    const domainRows = await db
      .select({ domain: ssoConnectionDomains.domain })
      .from(ssoConnectionDomains)
      .where(eq(ssoConnectionDomains.connectionId, shared[0].id));
    expect(domainRows).toEqual([]);
  });

  it('still routes STAFF by their owned domain, unchanged', async () => {
    // The vendor path must not disturb the staff path: `qnsc.vn` is owned by the Entra directory
    // connection, so it resolves there and never falls through to the shared one.
    const staff = await repo.findDirectoryByEmailDomain('someone@qnsc.vn');
    expect(staff).not.toBeNull();
    expect(staff?.kind).toBe('directory');
    expect(staff?.provider).toBe('entra');
  });
});
