/**
 * OWNER ⊆ the item's TEAM, over REAL HTTP.
 *
 * The gap this closes. `Phase 1/03_Work_Item_Detail/SRS.md` §7:125 — "A named Owner must be an active
 * member of the selected Team; if `teamId` is null, `assigneeId` must also be null/Unassigned" —
 * restated by `Phase 1/04:84` (a Task, against its inherited parent Team), `Phase 2/01:303` + AC-16:336
 * and `Phase 2/03:435`. None of it was enforced anywhere on the server:
 * `WorkItemsService.assertAssignmentScope` asked only `assertWorkspaceMember`, so
 * `POST /v1/work-items` with `{ teamId: null, assigneeId: <anyone> }` was accepted and the whole rule
 * lived in the SPA's picker FEED. `Phase 1/01_Project_Management/SRS.md:146` is the BA's own ruling on
 * that shape: "API must enforce project/team access; UI hide không đủ".
 *
 * Why it is driven through `app.inject()`. A spec that calls the service directly proves the rule but
 * not that the ROUTES reach it — the same blind spot that hid the `report:view` bug and the
 * `work_item` scope-resolver bug (see `task-routes.e2e.spec.ts`). The unit rule is pinned in
 * `work-items.service.spec.ts`; what is pinned HERE is that a request cannot get past it.
 *
 * Fixture facts this relies on, all from `db/seeds/demo.ts`: Team Alpha's roster is
 * admin/developer/viewer; Team BETA has no members at all and is linked to NXP, which makes it the
 * honest "linked team you are not on" case without writing a roster row.
 */
import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService, EntraTokenVerifier, type EntraClaims } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { WorkItemsService } from '@modules/work-items';
import { AppModule } from '../../apps/api/src/app.module';
import { adminActor, uniqueKey } from './support/flow-harness';
import {
  ADMIN_USER_ID,
  DEVELOPER_ID,
  NXP_ITER_CURRENT_ID,
  SEED_PROJECTS,
  TEAM_ALPHA_ID,
  TEAM_BETA_ID,
} from '../../db/seeds/constants';

// No `/v1` prefix: `Test.createTestingModule` builds the app without the bootstrap that sets the
// global prefix, so routes are mounted bare here.
describe('a work item Owner must belong to its Team (e2e)', () => {
  let app: NestFastifyApplication;
  let items: WorkItemsService;
  let db: DrizzleDB;
  let token: string;
  const projectId = SEED_PROJECTS[0].id;

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

    items = app.get(WorkItemsService);
    db = app.get<DrizzleDB>(DRIZZLE);
    // Bearer, not the BFF cookie: `requiresCsrfProtection` exempts Bearer callers, so no CSRF dance.
    // A Workspace Admin, deliberately — a refusal that survives the MOST privileged principal is the
    // only one that proves the rule is a data invariant rather than a permission check.
    token = (await app.get(AuthService).devLogin('admin@qnsc.dev', '127.0.0.1')).accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const create = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/work-items',
      headers: { authorization: `Bearer ${token}` },
      payload: { projectId, type: 'story', title: `Owner scope ${uniqueKey()}`, ...payload },
    });

  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/work-items/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  const codeOf = (body: string): string | undefined => {
    const parsed = JSON.parse(body) as { code?: string; error?: { code?: string } };
    return parsed.code ?? parsed.error?.code;
  };

  it('REFUSES a named Owner with no Team — the request that used to be accepted', async () => {
    const response = await create({ assigneeId: DEVELOPER_ID });
    expect(response.statusCode, response.body).toBe(412);
    expect(codeOf(response.body)).toBe('ASSIGNEE_REQUIRES_TEAM');
  });

  it('REFUSES an Owner who is not on the selected Team', async () => {
    // Beta is actively linked to NXP, so this clears `assertTeamLinkedToProject` and fails only on
    // the roster — which is what makes it a test of THIS rule and not of the team link.
    const response = await create({ teamId: TEAM_BETA_ID, assigneeId: DEVELOPER_ID });
    expect(response.statusCode, response.body).toBe(412);
    expect(codeOf(response.body)).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
  });

  it('accepts an Owner on the selected Team, and accepts Unassigned with no Team', async () => {
    const owned = await create({ teamId: TEAM_ALPHA_ID, assigneeId: DEVELOPER_ID });
    expect(owned.statusCode, owned.body).toBe(201);
    expect(JSON.parse(owned.body).assigneeId).toBe(DEVELOPER_ID);

    // The other side of §125's second clause: no Team AND no Owner is the ordinary backlog shape and
    // must stay legal, or Add New would be refused on every team-less project.
    const unowned = await create({});
    expect(unowned.statusCode, unowned.body).toBe(201);
  });

  /**
   * DECLARED CONSEQUENCE, not an incidental one. The population is the OWNER PICKER's own feed
   * (`GET /projects/:id/member-options?teamId=`), which excludes Workspace Admins — AC-16:336,
   * "Workspace Admin không phải delivery owner hợp lệ". The admin IS on Team Alpha's roster, so this
   * asserts the exclusion and not a missing membership row.
   *
   * That exclusion is flagged as a DECLARED CONFLICT in `listProjectMemberOptions`' own docblock. If
   * the BA rules the other way, this expectation flips to 201 and the code change is that one filter.
   */
  it('REFUSES a Workspace Admin as Owner, even on their own Team (AC-16)', async () => {
    const response = await create({ teamId: TEAM_ALPHA_ID, assigneeId: ADMIN_USER_ID });
    expect(response.statusCode, response.body).toBe(412);
    expect(codeOf(response.body)).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
  });

  it('REFUSES moving an owned item to a Team its Owner is not on', async () => {
    // The two-step hole: both requests are individually plausible, and only the second can see the
    // pair. Same shape as `ITERATION_TEAM_MISMATCH` before the update path revalidated on a team
    // change.
    const created = await create({ teamId: TEAM_ALPHA_ID, assigneeId: DEVELOPER_ID });
    const id = JSON.parse(created.body).id as string;

    const moved = await patch(id, { teamId: TEAM_BETA_ID });
    expect(moved.statusCode, moved.body).toBe(412);
    expect(codeOf(moved.body)).toBe('ASSIGNEE_NOT_TEAM_MEMBER');

    const cleared = await patch(id, { teamId: null });
    expect(cleared.statusCode, cleared.body).toBe(412);
    expect(codeOf(cleared.body)).toBe('ASSIGNEE_REQUIRES_TEAM');
  });

  it('lets an unrelated patch through on an item whose pair predates the rule', async () => {
    // Data written before this rule holds pairs it forbids. Refusing a title edit on one would make
    // those rows uneditable, so the pair is re-judged only when the Owner or the Team is moving.
    const story = await items.createWorkItem(
      adminActor(),
      projectId,
      'story',
      `Legacy pair ${uniqueKey()}`,
      { iterationId: NXP_ITER_CURRENT_ID, teamId: TEAM_ALPHA_ID, assigneeId: DEVELOPER_ID },
    );
    // Raw SQL, because the service now REFUSES to produce this pair — which is the point: it is only
    // reachable as pre-existing data, and that is exactly the row a title edit must not be refused on.
    await db.execute(
      sql`update work.work_items set team_id = ${TEAM_BETA_ID}::uuid where id = ${story.id}::uuid`,
    );

    const renamed = await patch(story.id, { title: 'renamed over HTTP' });
    expect(renamed.statusCode, renamed.body).toBe(200);

    // …but naming the Owner again on that same row IS refused, because now the Owner is moving.
    const reowned = await patch(story.id, { assigneeId: DEVELOPER_ID });
    expect(reowned.statusCode, reowned.body).toBe(412);
    expect(codeOf(reowned.body)).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
  });

  /** A Task's Owner is judged against the team it INHERITS from its parent (`Phase 1/04:84`). */
  it('REFUSES a Task Owner who is not on the parent Team', async () => {
    const parent = await items.createWorkItem(
      adminActor(),
      projectId,
      'story',
      `Task owner parent ${uniqueKey()}`,
      // No iteration: the seeded iterations belong to Team ALPHA, and pairing one with Team Beta is
      // refused by `ITERATION_TEAM_MISMATCH` before the Owner rule under test is ever reached.
      { teamId: TEAM_BETA_ID },
    );
    const response = await app.inject({
      method: 'POST',
      url: `/work-items/${parent.id}/tasks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: `Task owner ${uniqueKey()}`, assigneeId: DEVELOPER_ID },
    });
    expect(response.statusCode, response.body).toBe(412);
    expect(codeOf(response.body)).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
  });
});
