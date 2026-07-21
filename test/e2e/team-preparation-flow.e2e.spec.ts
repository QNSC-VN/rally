/**
 * BA business-flow E2E — E2E-002 "Admin prepares team and user for work management".
 *
 * This flow had NO automated coverage, and its absence is why the manual BA run
 * collapsed: E2E-00/01/04 were all blocked by "Team is not linked to this
 * project" (gaps DEV-003 / DEV-007). The team↔project link was missing from the
 * environment and nothing failed until a human tried to create a work item.
 *
 * Encodes the business rules verbatim from
 * 04_Developement_tracking/Phase 1/08_Manage_Projects_Teams_Users/SRS.md §2A:
 *
 *   - "a Team must be linked to at least one active Project before it can be
 *      selected in Backlog/Create/Detail flows"
 *   - "User project access is derived from team membership. The User management
 *      screen must not assign projects directly to a user."
 *   - "Work Item Project and Team must be a valid pair. If a user selects
 *      Project NXP, the Team dropdown can only show teams linked to NXP."
 *   - TEAM-FR-006 "Saving creates team and links it to selected project."
 *   - TEAM-FR-004 "Team key is normalized uppercase and validated unique."
 *
 * Each test asserts a rule that a wrong implementation would actually violate —
 * an unlinked team must be REJECTED, a cross-project team must be REJECTED, and
 * the prepared context must be USABLE by the Backlog. Asserting only that calls
 * succeed would have passed against the very state that blocked the BA run.
 *
 * Drives the REAL application services against the seeded DB.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import { TeamService } from '@modules/workspace';

import {
  ADMIN_USER_ID,
  ALL,
  DEVELOPER_ID,
  adminActor,
  bootRallyApp,
  uniqueKey,
} from './support/flow-harness';

describe('BA flows: E2E-002 admin prepares team and user for work management', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let teams: TeamService;
  let workItems: WorkItemsService;

  const admin = adminActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    teams = app.get(TeamService);
    workItems = app.get(WorkItemsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A project + team pair prepared exactly as the Manage screens would. */
  async function prepareLinkedContext() {
    const project = await projects.createProject(admin, {
      key: uniqueKey(),
      name: 'E2E-002 Delivery Project',
    });
    const team = await teams.createTeam(
      admin.workspaceId,
      'E2E-002 Team',
      uniqueKey('T'),
      undefined,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
    );
    await projects.linkTeam(admin.workspaceId, project.id, team.id);
    return { project, team };
  }

  describe('step 2 — create Team under Project (TEAM-FR-006)', () => {
    it("links the team to the project so it appears in that project's team list", async () => {
      const { project, team } = await prepareLinkedContext();

      const links = await projects.listProjectTeams(admin.workspaceId, project.id);
      const link = links.find((l) => l.teamId === team.id);

      expect(link).toBeDefined();
      expect(link?.status).toBe('active');
    });

    it('normalizes the team key to uppercase (TEAM-FR-004)', async () => {
      const key = uniqueKey('t').toLowerCase();
      const team = await teams.createTeam(
        admin.workspaceId,
        'E2E-002 Lowercase Key',
        key,
        undefined,
        ADMIN_USER_ID,
        ADMIN_USER_ID,
      );
      expect(team.key).toBe(key.toUpperCase());
    });

    it('rejects a duplicate team key in the same workspace (TEAM-FR-004)', async () => {
      const key = uniqueKey('T');
      await teams.createTeam(
        admin.workspaceId,
        'E2E-002 First',
        key,
        undefined,
        ADMIN_USER_ID,
        ADMIN_USER_ID,
      );
      await expect(
        teams.createTeam(
          admin.workspaceId,
          'E2E-002 Duplicate',
          key,
          undefined,
          ADMIN_USER_ID,
          ADMIN_USER_ID,
        ),
      ).rejects.toThrow(/TEAM_KEY_TAKEN|already taken/i);
    });
  });

  describe('rule — a team must be linked before it can be used (SRS §2A)', () => {
    // THE regression guard for DEV-003 / DEV-007. An unlinked team must be
    // rejected; if this ever silently succeeds, work items acquire a team their
    // project does not recognise and the Backlog/Team Status screens diverge.
    it('rejects a work item whose team is NOT linked to the project', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'E2E-002 Unlinked Guard',
      });
      const strangerTeam = await teams.createTeam(
        admin.workspaceId,
        'E2E-002 Unlinked Team',
        uniqueKey('T'),
        undefined,
        ADMIN_USER_ID,
        ADMIN_USER_ID,
      );
      // Deliberately NOT linked to `project`.

      await expect(
        workItems.createWorkItem(admin, project.id, 'story', 'Should be rejected', {
          teamId: strangerTeam.id,
        }),
      ).rejects.toThrow(/PROJECT_TEAM_LINK_NOT_FOUND|not linked/i);
    });

    it('rejects a team linked to a DIFFERENT project (valid Project–Team pair rule)', async () => {
      const { team: teamOfA } = await prepareLinkedContext();
      const projectB = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'E2E-002 Other Project',
      });

      await expect(
        workItems.createWorkItem(admin, projectB.id, 'story', 'Cross-project team', {
          teamId: teamOfA.id,
        }),
      ).rejects.toThrow(/PROJECT_TEAM_LINK_NOT_FOUND|not linked/i);
    });

    it('accepts the work item once the team IS linked', async () => {
      const { project, team } = await prepareLinkedContext();

      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Linked team ok', {
        teamId: team.id,
      });

      expect(story.teamId).toBe(team.id);
      expect(story.projectId).toBe(project.id);
    });
  });

  describe('steps 4–5 — the prepared context is usable by the Backlog', () => {
    // This is the assertion that would have caught the missing team_id seeding:
    // the Backlog filters work items by team, so a context that is "prepared"
    // but produces an empty Backlog is not actually prepared.
    it("returns the team's work item when the Backlog is filtered by that team", async () => {
      const { project, team } = await prepareLinkedContext();
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Backlog visible', {
        teamId: team.id,
      });

      const backlog = await workItems.listBacklog(admin, project.id, { teamId: team.id }, ALL);

      expect(backlog.data.map((w) => w.id)).toContain(story.id);
    });

    it("does NOT leak another team's work item into the filtered Backlog", async () => {
      const { project, team } = await prepareLinkedContext();
      const otherTeam = await teams.createTeam(
        admin.workspaceId,
        'E2E-002 Other Team',
        uniqueKey('T'),
        undefined,
        ADMIN_USER_ID,
        ADMIN_USER_ID,
      );
      await projects.linkTeam(admin.workspaceId, project.id, otherTeam.id);

      const mine = await workItems.createWorkItem(admin, project.id, 'story', 'Mine', {
        teamId: team.id,
      });
      const theirs = await workItems.createWorkItem(admin, project.id, 'story', 'Theirs', {
        teamId: otherTeam.id,
      });

      const backlog = await workItems.listBacklog(admin, project.id, { teamId: team.id }, ALL);
      const ids = backlog.data.map((w) => w.id);

      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
    });
  });

  describe('step 3 — user project access derives from team membership (SRS §2A)', () => {
    it('adds a workspace user to the team without assigning the project directly', async () => {
      const { team } = await prepareLinkedContext();

      const member = await teams.addTeamMember(
        team.id,
        DEVELOPER_ID,
        admin.workspaceId,
        ADMIN_USER_ID,
      );
      expect(member.userId).toBe(DEVELOPER_ID);

      const roster = await teams.listTeamMembers(team.id, admin.workspaceId);
      expect(roster.map((m) => m.userId)).toContain(DEVELOPER_ID);
    });

    it('refuses a user who is not a member of the owning workspace', async () => {
      const { team } = await prepareLinkedContext();
      const stranger = '00000000-0000-7000-8000-0000000009ff';

      await expect(
        teams.addTeamMember(team.id, stranger, admin.workspaceId, ADMIN_USER_ID),
      ).rejects.toThrow();
    });
  });
});
