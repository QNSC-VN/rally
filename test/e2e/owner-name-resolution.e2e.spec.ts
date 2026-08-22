/**
 * AN OWNER'S NAME IS A PROPERTY OF THE ROW, not of the picker feed the reader can see.
 *
 * Reported 2026-08-22: an Editor saw `No Entry` / `Unassigned` in the Owner and Dev Owner columns of
 * Iteration Status for items that WERE assigned — the detail page showed them, and a Workspace Admin
 * saw them everywhere. Not a permission fault: the grids held ids only and resolved the name client
 * side from a PICKER feed, and every picker feed narrows deliberately.
 *
 *   • `GET /projects/:id/member-options` excludes Workspace Admins — AC-16, they are not assignable
 *     owners — so it can never name one, for ANY role.
 *   • `GET /workspaces/:id/member-options` narrows a non-admin caller to the members and the
 *     `lead_id`s of their own readable projects.
 *
 * A Workspace Admin holds no `work.project_members` row at all (§2.1, migration 0118), so an item they
 * own had no name source in either feed, and an absent name is indistinguishable from an unset field.
 * A Workspace Admin reader never noticed because `listReadableProjectIds` returns `null` — unrestricted
 * — so their directory is the whole workspace.
 *
 * The read models now join the name (`ownerNameJoins`, and the iteration-status projection), which is
 * what Portfolio, Releases, Milestones and Quality already did. These tests assert it over real HTTP
 * for the EDITOR, because the fault only appeared for a narrowed principal — a service-level test with
 * the feeds mocked cannot see it at all.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/api/src/app.module';
import {
  ADMIN_USER_ID,
  NXP_ITER_CURRENT_ID,
  SEED_PROJECTS,
  TEAM_ALPHA_ID,
} from '../../db/seeds/constants';

const NXP = SEED_PROJECTS[0].id;

/** `app.inject().json()` is `any`; a typed local keeps the assertions off an unsafe value. */
const userIdsOf = (body: unknown): string[] =>
  (body as Array<{ userId: string }>).map((m) => m.userId);

interface OwnedRow {
  id: string;
  itemKey: string;
  assigneeId: string | null;
  assigneeName: string | null;
  devOwnerId: string | null;
  devOwnerName: string | null;
}

describe('owner names come from the row, not from a picker feed', () => {
  let app: NestFastifyApplication;
  let adminToken: string;
  let editorToken: string;
  let storyKey: string;
  let storyId: string;

  const as = (
    token: string,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService);
    adminToken = (await auth.devLogin('admin@qnsc.dev')).accessToken;
    editorToken = (await auth.devLogin('dev@qnsc.dev')).accessToken;

    // A story owned — Owner AND Dev Owner — by the WORKSPACE ADMIN, who by §2.1 appears in no
    // project roster. This is the row the report is about.
    const created = await as(adminToken, 'POST', '/work-items', {
      projectId: NXP,
      type: 'story',
      title: `Owner-name probe ${Date.now()}`,
      assigneeId: ADMIN_USER_ID,
      devOwnerId: ADMIN_USER_ID,
      // Team Alpha, which the seeded Editor belongs to: a team-LESS row is the Project Backlog and
      // admin-only (`PROJECT_BACKLOG_ADMIN_ONLY`), so without this the Editor cannot read the row at
      // all and the test would be measuring the team-scope rule instead of the name.
      teamId: TEAM_ALPHA_ID,
    });
    expect(created.statusCode, created.body).toBe(201);
    storyKey = created.json().itemKey;
    storyId = created.json().id;
    // Into the committed iteration, so the Iteration Status read model returns it.
    const scheduled = await as(adminToken, 'PATCH', `/work-items/${storyId}`, {
      iterationId: NXP_ITER_CURRENT_ID,
    });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the picker feeds genuinely cannot name this owner — the premise', async () => {
    const projectFeed = await as(editorToken, 'GET', `/projects/${NXP}/member-options`);
    expect(projectFeed.statusCode).toBe(200);
    // AC-16: a Workspace Admin is not an assignable owner, so the OFFER list must not carry them.
    // That is correct, and it is exactly why the name cannot come from here.
    expect(userIdsOf(projectFeed.json())).not.toContain(ADMIN_USER_ID);
  });

  it('Iteration Status names the Owner and the Dev Owner for an EDITOR', async () => {
    const res = await as(editorToken, 'GET', `/iterations/${NXP_ITER_CURRENT_ID}/status?limit=100`);

    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json().items as OwnedRow[]).find((i) => i.itemKey === storyKey);
    expect(row, 'the probe story must be in the iteration').toBeDefined();
    expect(row?.assigneeId).toBe(ADMIN_USER_ID);
    // The assertion the report is: an id with no name reads as unassigned on screen.
    expect(row?.assigneeName).toBeTruthy();
    expect(row?.devOwnerName).toBeTruthy();
  });

  it('the Backlog list names them too, and so does the same row for an ADMIN', async () => {
    // Backlog is the surface that was broken for EVERY role, because it consults only the project
    // feed — so the admin direction is the sharper assertion here.
    for (const token of [editorToken, adminToken]) {
      const res = await as(token, 'GET', `/work-items?projectId=${NXP}&limit=100`);
      expect(res.statusCode, res.body).toBe(200);
      const row = (res.json().data as OwnedRow[]).find((i) => i.itemKey === storyKey);
      expect(
        row?.assigneeName,
        `named for ${token === adminToken ? 'admin' : 'editor'}`,
      ).toBeTruthy();
    }
  });

  it('names the owner on the item the Tasks tab reads', async () => {
    const task = await as(adminToken, 'POST', `/work-items/${storyId}/tasks`, {
      title: 'Owner-name probe task',
      assigneeId: ADMIN_USER_ID,
    });
    expect(task.statusCode, task.body).toBe(201);

    const tasks = await as(editorToken, 'GET', `/work-items/${storyId}/tasks`);

    expect(tasks.statusCode, tasks.body).toBe(200);
    const taskRows: OwnedRow[] = tasks.json();
    const row = taskRows.find((t) => t.assigneeId === ADMIN_USER_ID);
    expect(row?.assigneeName).toBeTruthy();
  });

  it('does NOT widen the owner OFFER feed (WID-FR-016 / AC-16)', async () => {
    // Naming and offering are separate questions, and the fix must move only the first.
    const feed = await as(adminToken, 'GET', `/projects/${NXP}/member-options`);
    expect(userIdsOf(feed.json())).not.toContain(ADMIN_USER_ID);
  });
});
