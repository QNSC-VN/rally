/**
 * A WORKSPACE ADMIN MAY BE A TEAM MEMBER — operational scope only (BA feature, 2026-08-20).
 *
 * This reverses half of §2.1, and the half it does NOT reverse is what most of this file is about: a
 * Workspace Admin still holds no `work.project_members` row, so adding them to a Team must write the
 * roster row and nothing else. Their authority already comes from the workspace-wide grant, which is
 * why AC4's "Team membership does not convert their access to Admin or Editor" is a claim about what
 * is ABSENT after the write — and absence is exactly what a unit test with a mocked grant writer
 * cannot prove. Hence real HTTP against a real database.
 *
 * IT CREATES ITS OWN TEAM, and that is not tidiness. The seed puts the Workspace Admin on Team Alpha,
 * and `project-access-team-rule.e2e.spec.ts` ASSERTS that membership as the precondition of its
 * rollback proof — so an earlier version of this file, which removed the admin from Alpha in
 * `beforeAll`, passed alone and broke that spec in a full run. Same shape as the fixture leaks
 * CLAUDE.md records: a shared fixture is not a scratch pad. Creating a team also makes AC2's evidence
 * stronger than a seeded absence, because a team that has just been created with no members named is
 * exactly the case "not automatically a Team member" is about.
 *
 * Bearer token from `AuthService.devLogin`: Bearer callers are CSRF-exempt by design, and the test app
 * has no `/v1` prefix and no cookie plugin (`reply.setCookie is not a function`).
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService } from '@qnsc-vn/identity';
import { AccessService } from '@modules/access';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { randomUUID } from 'crypto';

import { AppModule } from '../../apps/api/src/app.module';
import { ADMIN_USER_ID, DEVELOPER_ID, SEED_PROJECTS, WORKSPACE_ID } from '../../db/seeds/constants';

const NXP = SEED_PROJECTS[0].id;

interface RosterRow {
  userId: string;
  isWorkspaceAdmin: boolean;
  displayName: string | null;
}

describe('a Workspace Admin as a Team member', () => {
  let app: NestFastifyApplication;
  let token: string;
  let access: AccessService;
  /** This file's OWN team — never a seeded one. See the docblock. */
  let teamId: string;

  const as = (
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

  const roster = async (): Promise<RosterRow[]> =>
    (await as('GET', `/teams/${teamId}/members`)).json();

  /** User ids out of any picker/roster payload, typed once so the assertions stay readable. */
  const userIdsOf = (body: unknown): string[] =>
    (body as Array<{ userId: string }>).map((m) => m.userId);

  /** The rows §2.1 keeps a Workspace Admin off, read through the API that reports them. */
  const projectAccessRows = async (): Promise<Array<{ userId: string }>> => {
    const res = await as('GET', `/projects/${NXP}/members`);
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    token = (await app.get(AuthService).devLogin('admin@qnsc.dev')).accessToken;
    access = app.get(AccessService);

    // `varchar(10)`, uppercase, and unique per run — a fixed key would collide with itself on the
    // second run, since a team cannot be deleted (only deactivated, DB design §488).
    const key = `W${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
    const created = await as('POST', `/workspaces/${WORKSPACE_ID}/teams`, {
      name: `WA membership ${key}`,
      key,
      projectIds: [NXP],
      // One ORDINARY member, named explicitly. It gives the badge something to contrast against, and
      // it makes AC2 sharper: a team created WITH a member still does not enrol the admin.
      memberUserIds: [DEVELOPER_ID],
    });
    expect(created.statusCode, created.body).toBe(201);
    teamId = created.json().id;
  }, 60_000);

  afterAll(async () => {
    // Deactivated rather than left active: the team picker and `GET /projects/:id/teams` are populations
    // other specs measure, and an archived team keeps its history (§488) so nothing is destroyed.
    await as('DELETE', `/teams/${teamId}/members/${ADMIN_USER_ID}`);
    await as('PATCH', `/teams/${teamId}`, { status: 'archived' });
    await app?.close();
  });

  it('is NOT a member until someone says so (AC2)', async () => {
    expect((await roster()).map((m) => m.userId)).not.toContain(ADMIN_USER_ID);
  });

  it('is added, and the roster badges them rather than showing a level (AC1)', async () => {
    const added = await as('POST', `/teams/${teamId}/members`, { userId: ADMIN_USER_ID });

    expect(added.statusCode).toBe(201);
    expect(added.json().isWorkspaceAdmin).toBe(true);

    const row = (await roster()).find((m) => m.userId === ADMIN_USER_ID);
    expect(row).toBeDefined();
    expect(row?.isWorkspaceAdmin).toBe(true);
    // The badge is only meaningful if the ordinary members are distinguishable from it.
    expect((await roster()).some((m) => !m.isWorkspaceAdmin)).toBe(true);
  });

  it('gains NO project-access assignment from the membership (AC1/AC4)', async () => {
    await as('POST', `/teams/${teamId}/members`, { userId: ADMIN_USER_ID });

    // RBE-06 grants `editor` from a roster row for everyone else; for a Workspace Admin the grant
    // writer skips, because §2.1 says they are not a Project user. This is the assertion that the
    // reversal did not take the other half with it.
    expect((await projectAccessRows()).map((r) => r.userId)).not.toContain(ADMIN_USER_ID);
    expect(await access.getProjectAccessLevel(WORKSPACE_ID, ADMIN_USER_ID, NXP)).toBeNull();
  });

  it('keeps full Workspace authority while on the Team (AC4)', async () => {
    await as('POST', `/teams/${teamId}/members`, { userId: ADMIN_USER_ID });

    expect(await access.isWorkspaceAdmin(WORKSPACE_ID, ADMIN_USER_ID)).toBe(true);
    // Read through the permission resolver rather than the role table: `workspace:*` is what actually
    // grants, and a project-tier code proves the grant still reaches project surfaces.
    expect(
      await access.hasProjectPermission(
        { sub: ADMIN_USER_ID, workspaceId: WORKSPACE_ID } as never,
        NXP,
        'work_item:edit',
      ),
    ).toBe(true);
  });

  it('is selectable as a Work Item Owner in that Team (AC3)', async () => {
    await as('POST', `/teams/${teamId}/members`, { userId: ADMIN_USER_ID });

    const res = await as('GET', `/projects/${NXP}/member-options?teamId=${teamId}`);

    expect(res.statusCode).toBe(200);
    expect(userIdsOf(res.json())).toContain(ADMIN_USER_ID);
  });

  it('is selectable as a Project Owner whether or not they are on a Team (AC3)', async () => {
    // The workspace picker feed, which is what the Project Owner field reads.
    const res = await as('GET', `/workspaces/${WORKSPACE_ID}/member-options`);

    expect(res.statusCode).toBe(200);
    expect(userIdsOf(res.json())).toContain(ADMIN_USER_ID);
  });

  it('loses only the membership on removal (AC5)', async () => {
    await as('POST', `/teams/${teamId}/members`, { userId: ADMIN_USER_ID });

    const removed = await as('DELETE', `/teams/${teamId}/members/${ADMIN_USER_ID}`);

    expect(removed.statusCode).toBe(204);
    expect((await roster()).map((m) => m.userId)).not.toContain(ADMIN_USER_ID);
    expect(await access.isWorkspaceAdmin(WORKSPACE_ID, ADMIN_USER_ID)).toBe(true);
    expect(
      await access.hasProjectPermission(
        { sub: ADMIN_USER_ID, workspaceId: WORKSPACE_ID } as never,
        NXP,
        'work_item:edit',
      ),
    ).toBe(true);
  });

  it('reports the same membership state to every view that carries it (AC6)', async () => {
    await as('POST', `/teams/${teamId}/members`, { userId: ADMIN_USER_ID });

    const teams: Array<{ teamId: string; memberCount?: number }> = (
      await as('GET', `/projects/${NXP}/teams`)
    ).json();
    const own = teams.find((t) => t.teamId === teamId);
    const rosterSize = (await roster()).length;

    // The count beside the roster and the roster itself are the pair this repo has seen disagree
    // before (a WA hidden from one and counted by the other).
    if (own?.memberCount !== undefined) expect(own.memberCount).toBe(rosterSize);
  });
});
