// Load .env for local dev; in CI the env vars are injected directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI mode */
}

/**
 * Demo tier — sample workspace fixtures that populate dev / staging / E2E so
 * the app never renders empty states: demo users, 2 projects (NXP + MOB), and
 * ONE fully-linked end-to-end flow inside NXP — Team (with members) → Story +
 * Defect (team-linked) → 2 Tasks under the Story (team/iteration inherited)
 * → Iteration (contains the Story + Defect) → Release + Milestone (linked to
 * each other and to the Story). See seedFlow() for the full relation graph.
 * MOB carries no work-item/team/release/iteration fixtures of its own — it
 * exists only so the RBAC/PBAC demo user has a second project to be scoped
 * against (project_admin on NXP, project_viewer on MOB).
 *
 * These are FIXTURES only — never real production. `seed()` first runs the two
 * prod-safe tiers (seedTenantBootstrapInto + seedSystemRolesInto) so role
 * assignments resolve, then layers the demo data on top. Each helper also
 * creates/updates the reference + related rows its fixtures depend on
 * (counters, workflow statuses, project members, project-team links).
 *
 * Entrypoint  : db/seeds/seed.ts (barrel) — pnpm db:seed
 * Called by   : db/migrate.ts when SEED_ON_DEPLOY=true (develop env only)
 * Idempotent — safe to run multiple times (fixed UUIDs + onConflictDoNothing).
 * Refuses to run in production unless SEED_ON_DEPLOY=true (develop runs with
 * NODE_ENV=production but opts in).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgOptions } from '../pg-ssl';
import { uuidv7 } from 'uuidv7';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
// Direct imports to avoid barrel tsx/CJS resolution edge cases at runtime.
import {
  projectCounters,
  projectMembers,
  projectTeams,
  workItems,
  iterations,
  releases,
  teams,
  teamMembers,
  tasks,
  milestones,
  milestoneReleases,
  milestoneProjects,
  milestoneArtifacts,
  memberCapacity,
  comments,
  labels,
  workItemLabels,
  timeLogs,
  workItemWatchers,
} from '../schema/work';
import { userRoleAssignments } from '../schema/access';
import { SYSTEM_ROLE, type SystemRoleSlug } from '../permissions.catalog';
import { seedSystemRolesInto } from './reference';
import { seedTenantBootstrapInto } from './bootstrap';
import {
  type Db,
  DEFAULT_WORKFLOW_STATUSES,
  getDeterministicRank,
  ADMIN_USER_ID,
  WORKSPACE_ID,
  DEVELOPER_ID,
  VIEWER_ID,
  PROJECT_ADMIN_ID,
  WORKSPACE_MEMBER_ID,
  PROJECT_LEAD_ID,
  NXP_STORY_1_ID,
  NXP_DEFECT_1_ID,
  NXP_TASK_1_ID,
  NXP_TASK_2_ID,
  TEAM_ALPHA_ID,
  NXP_RELEASE_1_ID,
  NXP_ITER_CURRENT_ID,
  NXP_MILESTONE_1_ID,
  SEED_PROJECTS,
} from './constants';

// Assigned inside seed() before any helper function runs.
let db: Db;

async function seedProject(project: {
  id: string;
  key: string;
  name: string;
  description: string;
}) {
  // 1. Insert project row with fixed UUID (idempotent by primary key).
  //    If a project with the same key already exists (dev DB), fall back to
  //    the existing row so subsequent steps use the correct project_id.
  const inserted = await db
    .insert(schema.projects)
    .values({
      id: project.id,
      workspaceId: WORKSPACE_ID,
      key: project.key,
      name: project.name,
      description: project.description,
      leadId: ADMIN_USER_ID,
      status: 'active',
    })
    .onConflictDoNothing()
    .returning({ id: schema.projects.id });

  // Resolve the actual project ID (fresh DB → inserted ID; existing DB → look up by key)
  let actualId = inserted[0]?.id;
  if (!actualId) {
    const existing = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(eq(schema.projects.workspaceId, WORKSPACE_ID), eq(schema.projects.key, project.key)),
      )
      .limit(1);
    actualId = existing[0]?.id;
  }
  if (!actualId) return; // should never happen

  // 2. Initialise the item-key counter per work-item type (mirrors ProjectsService.createProject)
  const counterTypes = ['initiative', 'feature', 'story', 'task', 'defect'] as const;
  for (const itemType of counterTypes) {
    await db
      .insert(schema.projectCounters)
      .values({ projectId: actualId, workspaceId: WORKSPACE_ID, itemType, lastItemNumber: 0 })
      .onConflictDoNothing();
  }

  // 3. Add the lead as the first active project member if not already present
  await db
    .insert(projectMembers)
    .values({
      id: uuidv7(),
      workspaceId: WORKSPACE_ID,
      projectId: actualId,
      userId: ADMIN_USER_ID,
      status: 'active',
    })
    .onConflictDoNothing();

  // 4. Seed default workflow statuses only if none exist yet for this project
  //    (avoids duplicating the 4 default statuses on re-seed)
  const existingStatuses = await db
    .select({ id: schema.workflowStatuses.id })
    .from(schema.workflowStatuses)
    .where(eq(schema.workflowStatuses.projectId, actualId))
    .limit(1);

  if (existingStatuses.length === 0) {
    for (const s of DEFAULT_WORKFLOW_STATUSES) {
      await db
        .insert(schema.workflowStatuses)
        .values({
          id: uuidv7(),
          workspaceId: WORKSPACE_ID,
          projectId: actualId,
          name: s.name,
          category: s.category,
          color: s.color,
          position: s.position,
          isDefault: s.isDefault,
        })
        .onConflictDoNothing();
    }
  }
}

// ── The one end-to-end demo flow (NXP only) ───────────────────────────────────
// Team Alpha (with members) → Story + Defect (team-linked) → 2 Tasks under the
// Story (team + iteration inherited from the parent, mirroring
// WorkItemsService.createTask's `teamId: opts.teamId ?? parent.teamId` and
// `iterationId: opts.iterationId ?? parent.iterationId` rules) → Iteration
// (contains the Story + Defect) → Release + Milestone (linked to each other
// and to the Story). Every FK below resolves to a real, matching row — no
// orphaned workspace_ids, no team-less tasks, no milestone dates that don't
// match their linked release's actual dates.
//
// Idempotent: fixed UUIDs + onConflictDoNothing throughout.
async function seedFlow() {
  const nxpId = SEED_PROJECTS[0].id;

  // ── 1. Team Alpha (with members) ────────────────────────────────────────
  await db
    .insert(teams)
    .values({
      id: TEAM_ALPHA_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Team Alpha',
      key: 'ALPHA',
      description: 'Core platform team — owns NX Platform.',
      leadId: ADMIN_USER_ID,
      status: 'active',
    })
    .onConflictDoNothing();

  // Members: the 3 core users + the 3 RBAC/PBAC demo users, so the Team
  // Status roster has real coverage (including zero-task members, whose load
  // bar renders empty) without needing a second team.
  await db
    .insert(teamMembers)
    .values([
      {
        id: '00000000-0000-7000-8000-000000000080',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ALPHA_ID,
        userId: ADMIN_USER_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000081',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ALPHA_ID,
        userId: DEVELOPER_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000084',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ALPHA_ID,
        userId: VIEWER_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000085',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ALPHA_ID,
        userId: PROJECT_ADMIN_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000086',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ALPHA_ID,
        userId: WORKSPACE_MEMBER_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000087',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ALPHA_ID,
        userId: PROJECT_LEAD_ID,
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // Link the team to NXP (project_teams) — creating a work item into an
  // iteration validates the team is linked to the project (assertTeamLinked);
  // without this link, "Add Item" fails with "Team is not linked to this
  // project".
  await db
    .insert(projectTeams)
    .values({
      id: '00000000-0000-7000-8000-000000000090',
      workspaceId: WORKSPACE_ID,
      projectId: nxpId,
      teamId: TEAM_ALPHA_ID,
      status: 'active',
    })
    .onConflictDoNothing();

  // ── 2. Release (real startDate + releaseDate — the milestone's derived ──
  //    dates below are set to literally match these, by construction; see
  //    MilestonesService.recalcTargetDates: MIN(release.startDate) /
  //    MAX(release.releaseDate) over the release(s) linked to a milestone).
  await db
    .insert(releases)
    .values({
      id: NXP_RELEASE_1_ID,
      workspaceId: WORKSPACE_ID,
      projectId: nxpId,
      name: 'v2.0 — NX Platform Upgrade',
      description: 'Major upgrade to NX v21 + ESLint flat-config rollout.',
      status: 'planning',
      startDate: '2026-07-01',
      releaseDate: '2026-07-31',
    })
    .onConflictDoNothing();

  // ── 3. Iteration (committed — the active sprint), team-linked ──────────
  await db
    .insert(iterations)
    .values({
      id: NXP_ITER_CURRENT_ID,
      workspaceId: WORKSPACE_ID,
      projectId: nxpId,
      teamId: TEAM_ALPHA_ID,
      iterationKey: 'IT-1',
      name: 'Sprint 26.1',
      goal: 'Ship NX v21 upgrade and ESLint flat-config across all apps.',
      theme: 'NX Platform Modernisation',
      state: 'committed',
      plannedVelocity: 21,
      startDate: '2026-06-16',
      endDate: '2026-06-27',
    })
    .onConflictDoNothing();

  // ── 4. Milestone, linked to the release + project. Target dates equal ──
  //    MIN/MAX over the single linked release above — MUST stay in sync with
  //    the release's startDate/releaseDate by construction (single release,
  //    so MIN == MAX == that release's own dates).
  await db
    .insert(milestones)
    .values({
      id: NXP_MILESTONE_1_ID,
      workspaceId: WORKSPACE_ID,
      projectId: nxpId,
      name: 'GA — NX Platform v2',
      description: 'General availability of the v2 platform.',
      status: 'planned',
      ownerId: ADMIN_USER_ID,
      targetStartDate: '2026-07-01', // = NXP_RELEASE_1 startDate
      targetEndDate: '2026-07-31', // = NXP_RELEASE_1 releaseDate
    })
    .onConflictDoNothing();
  await db
    .insert(milestoneReleases)
    .values({ milestoneId: NXP_MILESTONE_1_ID, releaseId: NXP_RELEASE_1_ID })
    .onConflictDoNothing();
  await db
    .insert(milestoneProjects)
    .values({ milestoneId: NXP_MILESTONE_1_ID, projectId: nxpId })
    .onConflictDoNothing();

  // ── 5. Story + Defect (both team-linked, in the iteration + release) ───
  const statusRows = await db
    .select({
      id: schema.workflowStatuses.id,
      category: schema.workflowStatuses.category,
    })
    .from(schema.workflowStatuses)
    .where(eq(schema.workflowStatuses.projectId, nxpId));
  const todoStatus = statusRows.find((s) => s.category === 'to_do')?.id;
  const inProgressStatus = statusRows.find((s) => s.category === 'in_progress')?.id;
  if (!todoStatus || !inProgressStatus) {
    throw new Error('seedFlow: NXP workflow statuses missing — seedProject must run first');
  }

  await db
    .insert(workItems)
    .values([
      {
        id: NXP_STORY_1_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        releaseId: NXP_RELEASE_1_ID,
        itemKey: 'US-1',
        type: 'story' as const,
        title: 'Upgrade NX workspace to v21',
        statusId: inProgressStatus,
        scheduleState: 'in_progress' as const,
        priority: 'high' as const,
        storyPoints: '5',
        assigneeId: ADMIN_USER_ID,
        createdBy: ADMIN_USER_ID,
        rank: getDeterministicRank('US-1'),
      },
      {
        id: NXP_DEFECT_1_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        itemKey: 'DE-1',
        type: 'defect' as const,
        title: 'CI pipeline fails intermittently on Windows build agents',
        statusId: inProgressStatus,
        scheduleState: 'in_progress' as const,
        priority: 'urgent' as const,
        assigneeId: DEVELOPER_ID,
        createdBy: ADMIN_USER_ID,
        rank: getDeterministicRank('DE-1'),
        // Defect-specific fields (P3.4) — Quality board coverage.
        severity: 'major' as const,
        foundInEnvironment: 'staging' as const,
        rootCause: 'code' as const,
        defectState: 'open' as const,
      },
    ])
    .onConflictDoNothing();

  // Assign the Story to the milestone (Iteration Status "Milestones" column).
  await db
    .insert(milestoneArtifacts)
    .values({ milestoneId: NXP_MILESTONE_1_ID, workItemId: NXP_STORY_1_ID })
    .onConflictDoNothing();

  // ── 6. 2 Tasks under the Story — team/iteration EXPLICITLY inherited from ─
  //    the parent, mirroring WorkItemsService.createTask's real business rule
  //    (`teamId: opts.teamId ?? parent.teamId`, `iterationId: opts.iterationId
  //    ?? parent.iterationId`) so no seeded task is ever team-less.
  await db
    .insert(tasks)
    .values([
      {
        id: NXP_TASK_1_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        parentId: NXP_STORY_1_ID,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        itemKey: 'TA-1',
        title: 'Update workspace.json for NX v21 breaking changes',
        state: 'completed' as const,
        assigneeId: DEVELOPER_ID,
        estimateHours: '2',
        actualHours: '1.5',
        rank: getDeterministicRank('TA-1'),
        createdBy: ADMIN_USER_ID,
      },
      {
        id: NXP_TASK_2_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        parentId: NXP_STORY_1_ID,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        itemKey: 'TA-2',
        title: 'Validate all affected generators after upgrade',
        state: 'in_progress' as const,
        assigneeId: ADMIN_USER_ID,
        estimateHours: '3',
        todoHours: '2',
        rank: getDeterministicRank('TA-2'),
        createdBy: ADMIN_USER_ID,
      },
    ])
    .onConflictDoNothing();

  // ── 7. Per-type counters — keep in lock-step with what was actually ────
  //    seeded so a later app-created item never collides on the unique
  //    (project_id, item_key) index.
  await db
    .update(projectCounters)
    .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 1)` })
    .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'story')));
  await db
    .update(projectCounters)
    .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 1)` })
    .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'defect')));
  await db
    .update(projectCounters)
    .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 2)` })
    .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'task')));

  // ── 8. Activity logs (Revision History tab) ─────────────────────────────
  const existingActivity = await db
    .select({ id: schema.activityLogs.id })
    .from(schema.activityLogs)
    .where(eq(schema.activityLogs.workItemId, NXP_STORY_1_ID))
    .limit(1);
  if (existingActivity.length === 0) {
    type ActivityRow = typeof schema.activityLogs.$inferInsert;
    const rows: ActivityRow[] = [
      {
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        workItemId: NXP_STORY_1_ID,
        entityType: 'work_item',
        entityId: NXP_STORY_1_ID,
        actorId: ADMIN_USER_ID,
        action: 'work_item.created',
        changes: null,
        metadata: { title: 'Upgrade NX workspace to v21', type: 'story' },
      },
      {
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        workItemId: NXP_STORY_1_ID,
        entityType: 'work_item',
        entityId: NXP_STORY_1_ID,
        actorId: ADMIN_USER_ID,
        action: 'work_item.assigned',
        changes: { field: 'assigneeId', old: null, new: ADMIN_USER_ID },
        metadata: {},
      },
      {
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        workItemId: NXP_STORY_1_ID,
        entityType: 'work_item',
        entityId: NXP_STORY_1_ID,
        actorId: DEVELOPER_ID,
        action: 'work_item.schedule_state_changed',
        changes: { field: 'scheduleState', old: 'defined', new: 'in_progress' },
        metadata: {},
      },
      {
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        workItemId: NXP_DEFECT_1_ID,
        entityType: 'work_item',
        entityId: NXP_DEFECT_1_ID,
        actorId: DEVELOPER_ID,
        action: 'work_item.created',
        changes: null,
        metadata: {
          title: 'CI pipeline fails intermittently on Windows build agents',
          type: 'defect',
        },
      },
      {
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        workItemId: NXP_DEFECT_1_ID,
        entityType: 'work_item',
        entityId: NXP_DEFECT_1_ID,
        actorId: ADMIN_USER_ID,
        action: 'work_item.priority_changed',
        changes: { field: 'priority', old: 'normal', new: 'urgent' },
        metadata: {},
      },
    ];
    await db.insert(schema.activityLogs).values(rows);
  }

  // ── 9. Member capacity — Team Alpha in the active iteration (Team Status) ─
  await db
    .insert(memberCapacity)
    .values([
      {
        id: '00000000-0000-7000-8000-0000000000c0',
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        userId: ADMIN_USER_ID,
        capacityHours: '60',
      },
      {
        id: '00000000-0000-7000-8000-0000000000c1',
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        userId: DEVELOPER_ID,
        capacityHours: '72',
      },
    ])
    .onConflictDoNothing();

  // ── 10. Labels + assignments ────────────────────────────────────────────
  const LBL_BUG = '00000000-0000-7000-8000-0000000000d0';
  const LBL_UX = '00000000-0000-7000-8000-0000000000d2';
  await db
    .insert(labels)
    .values([
      { id: LBL_BUG, workspaceId: WORKSPACE_ID, projectId: nxpId, name: 'bug', color: '#e5484d' },
      { id: LBL_UX, workspaceId: WORKSPACE_ID, projectId: nxpId, name: 'ux', color: '#3b82f6' },
    ])
    .onConflictDoNothing();
  await db
    .insert(workItemLabels)
    .values([
      { workItemId: NXP_DEFECT_1_ID, labelId: LBL_BUG },
      { workItemId: NXP_STORY_1_ID, labelId: LBL_UX },
    ])
    .onConflictDoNothing();

  // ── 11. Comments (one threaded reply on the Story, one on the Defect) ──
  await db
    .insert(comments)
    .values([
      {
        id: '00000000-0000-7000-8000-0000000000e0',
        workspaceId: WORKSPACE_ID,
        workItemId: NXP_STORY_1_ID,
        authorId: ADMIN_USER_ID,
        body: 'Kicking this off for the v2 milestone — aligning scope with the GA release.',
      },
      {
        id: '00000000-0000-7000-8000-0000000000e1',
        workspaceId: WORKSPACE_ID,
        workItemId: NXP_STORY_1_ID,
        authorId: DEVELOPER_ID,
        body: 'Picking it up. Will break the API work into tasks.',
        parentId: '00000000-0000-7000-8000-0000000000e0',
      },
      {
        id: '00000000-0000-7000-8000-0000000000e2',
        workspaceId: WORKSPACE_ID,
        workItemId: NXP_DEFECT_1_ID,
        authorId: DEVELOPER_ID,
        body: 'Reproduced on the Windows build agent; looks like a flaky checkout step.',
      },
    ])
    .onConflictDoNothing();

  // ── 12. Time logs ────────────────────────────────────────────────────────
  await db
    .insert(timeLogs)
    .values([
      {
        id: '00000000-0000-7000-8000-0000000000f0',
        workspaceId: WORKSPACE_ID,
        workItemId: NXP_STORY_1_ID,
        userId: DEVELOPER_ID,
        loggedDate: '2026-06-24',
        hours: '4.5',
        description: 'workspace.json migration + generator validation',
      },
      {
        id: '00000000-0000-7000-8000-0000000000f1',
        workspaceId: WORKSPACE_ID,
        workItemId: NXP_DEFECT_1_ID,
        userId: DEVELOPER_ID,
        loggedDate: '2026-06-25',
        hours: '2',
        description: 'Debug flaky Windows CI checkout step',
      },
    ])
    .onConflictDoNothing();

  // ── 13. Watchers ─────────────────────────────────────────────────────────
  await db
    .insert(workItemWatchers)
    .values([
      { workItemId: NXP_STORY_1_ID, userId: ADMIN_USER_ID, workspaceId: WORKSPACE_ID },
      { workItemId: NXP_DEFECT_1_ID, userId: DEVELOPER_ID, workspaceId: WORKSPACE_ID },
    ])
    .onConflictDoNothing();

  console.log(
    '✅  Demo flow seeded — Team Alpha, Story + Defect (team+iteration+release-linked), 2 Tasks, ' +
      '1 Iteration, 1 Release, 1 Milestone, plus capacity/labels/comments/time logs/watchers',
  );
}

/**
 * Run all DEMO seed operations against the given database URL: the sample `acme`
 * workspace, demo users, projects, work items, teams, releases, iterations and a
 * dev SSO connection. These are FIXTURES for dev/staging/E2E only — never real
 * production. The reference role catalogue (seedSystemRoles) is invoked first so
 * role assignments resolve; that part is prod-safe, the rest is not.
 *
 * Exported so db/migrate.ts can call it when SEED_ON_DEPLOY=true.
 * Safe to call multiple times — all inserts use onConflictDoNothing.
 */
export async function seed(connectionUrl?: string): Promise<void> {
  // Develop runs with NODE_ENV=production but legitimately opts into seeding via
  // SEED_ON_DEPLOY=true. Only a real production deploy (no SEED_ON_DEPLOY) is blocked.
  if (process.env['NODE_ENV'] === 'production' && process.env['SEED_ON_DEPLOY'] !== 'true') {
    throw new Error('Seed script must not run in production (NODE_ENV=production).');
  }

  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  db = drizzle(pool, { schema });

  try {
    console.log('Seeding...');

    // ── Workspace + SSO connection (shared prod-safe bootstrap) ───────────────
    // The primary workspace and its Entra SSO connection are created by the same
    // prod-safe routine used on real deploys, so dev and prod resolve identically.
    await seedTenantBootstrapInto(db);

    // ── Admin user ───────────────────────────────────────────────────────────
    // SSO-only: no password. The platform-admin email is seeded so the first
    // Entra SSO login merges into this row (upsertBySsoIdentity matches by email)
    // and PLATFORM_ADMIN_EMAILS auto-elevates it to workspace_admin.
    const adminEmail = process.env['ADMIN_EMAIL'] ?? 'admin@acme.dev';
    await db
      .insert(schema.users)
      .values({
        id: ADMIN_USER_ID,
        email: adminEmail,
        displayName: 'Admin User',
        emailVerified: true,
        locale: 'en',
        timezone: 'Asia/Ho_Chi_Minh',
      })
      .onConflictDoNothing();

    // ── Workspace member ─────────────────────────────────────────────────────
    await db
      .insert(schema.workspaceMembers)
      .values({
        workspaceId: WORKSPACE_ID,
        userId: ADMIN_USER_ID,
      })
      .onConflictDoNothing();

    // ── Additional users: developer + viewer ─────────────────────────────────
    // SSO-only: passwordless. Sign in via Entra; roles are assigned below.
    await db
      .insert(schema.users)
      .values([
        {
          id: DEVELOPER_ID,
          email: 'dev@acme.dev',
          displayName: 'Alice Developer',
          emailVerified: true,
          locale: 'en',
          timezone: 'Asia/Ho_Chi_Minh',
        },
        {
          id: VIEWER_ID,
          email: 'viewer@acme.dev',
          displayName: 'Bob Viewer',
          emailVerified: true,
          locale: 'en',
          timezone: 'Asia/Ho_Chi_Minh',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(schema.workspaceMembers)
      .values([
        { workspaceId: WORKSPACE_ID, userId: DEVELOPER_ID },
        { workspaceId: WORKSPACE_ID, userId: VIEWER_ID },
      ])
      .onConflictDoNothing();

    // ── System roles ─────────────────────────────────────────────────────────
    // Reference catalogue (roles + permission grants). Shared with the prod-safe
    // standalone entrypoint so dev seeds and production deploys stay in lock-step.
    await seedSystemRolesInto(db);

    // Resolve a role id preferring the workspace-owned editable copy over the
    // global template (both share a slug after migration 0047). Workspace Admin
    // has no per-workspace copy, so it resolves to the global immutable anchor.
    const resolveRoleId = async (slug: string): Promise<string | undefined> => {
      const rows = await db
        .select({ id: schema.systemRoles.id, workspaceId: schema.systemRoles.workspaceId })
        .from(schema.systemRoles)
        .where(
          and(
            eq(schema.systemRoles.slug, slug),
            or(
              isNull(schema.systemRoles.workspaceId),
              eq(schema.systemRoles.workspaceId, WORKSPACE_ID),
            ),
          ),
        );
      return (rows.find((r) => r.workspaceId === WORKSPACE_ID) ?? rows[0])?.id;
    };

    // ── Admin user role assignment (workspace_admin for the default workspace) ──
    const adminRoleId = await resolveRoleId('workspace_admin');

    if (adminRoleId) {
      await db
        .insert(userRoleAssignments)
        .values({
          workspaceId: WORKSPACE_ID,
          userId: ADMIN_USER_ID,
          roleId: adminRoleId,
          scopeType: 'workspace',
          scopeId: WORKSPACE_ID,
          grantedBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }

    // ── Developer role assignment (project_member) ────────────────────────────
    const memberRoleId = await resolveRoleId('project_member');

    if (memberRoleId) {
      await db
        .insert(userRoleAssignments)
        .values({
          workspaceId: WORKSPACE_ID,
          userId: DEVELOPER_ID,
          roleId: memberRoleId,
          scopeType: 'workspace',
          scopeId: WORKSPACE_ID,
          grantedBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }

    // ── Viewer role assignment (project_viewer) ───────────────────────────────
    const viewerRoleId = await resolveRoleId('project_viewer');

    if (viewerRoleId) {
      await db
        .insert(userRoleAssignments)
        .values({
          workspaceId: WORKSPACE_ID,
          userId: VIEWER_ID,
          roleId: viewerRoleId,
          scopeType: 'workspace',
          scopeId: WORKSPACE_ID,
          grantedBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }

    // ── Projects (real business flow: project + counter + member + statuses) ──
    for (const project of SEED_PROJECTS) {
      await seedProject(project);
    }

    // ── Add developer as NXP project member (so seeded assigneeId is valid) ──
    await db
      .insert(projectMembers)
      .values({
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: SEED_PROJECTS[0].id, // NXP
        userId: DEVELOPER_ID,
        status: 'active',
      })
      .onConflictDoNothing();

    // ── RBAC/PBAC demo users (role coverage + per-project scoping) ───────────
    await seedRbacDemoUsers();

    // ── The one end-to-end demo flow (team, story+defect, tasks, iteration, ──
    // release, milestone — see seedFlow() for the full relation graph) ───────
    await seedFlow();

    console.log(
      `✅  Seed complete — ${SEED_PROJECTS.length} projects, 6 users, 1 team, 1 iteration, 1 release, 1 milestone, 1 story + 1 defect + 2 tasks (one fully-linked flow)`,
    );
  } finally {
    await pool.end();
  }
}

// ── RBAC/PBAC demo users ─────────────────────────────────────────────────────
// The 3 primary users (admin/dev/viewer) only cover workspace_admin,
// project_member and project_viewer. This seeds one user for each remaining
// system role so the FE can exercise every role state, plus a PROJECT-scoped
// "lead" that proves per-project (PBAC) resolution: project_admin on NXP,
// project_viewer on MOB, and only baseline (workspace_member fallback) elsewhere.
//
// Business note: the implemented catalogue roles are workspace_admin /
// project_admin / project_member / project_viewer / workspace_member.
// The early UI mockup used Project Manager / Product Owner / Tester instead; the
// catalogue (db/permissions.catalog.ts) is the current source of truth. If BA
// re-scopes roles, update the catalogue + these demo assignments together.
//
// Idempotent (fixed UUIDs + onConflictDoNothing). All are passwordless — sign in
// via Entra SSO; the seeded email lets the first SSO login merge into these rows.
async function seedRbacDemoUsers(): Promise<void> {
  const demoUsers = [
    { id: PROJECT_ADMIN_ID, email: 'projectadmin@acme.dev', displayName: 'Carol ProjectAdmin' },
    { id: WORKSPACE_MEMBER_ID, email: 'member@acme.dev', displayName: 'Dave Member' },
    { id: PROJECT_LEAD_ID, email: 'lead@acme.dev', displayName: 'Frank Lead' },
  ];

  await db
    .insert(schema.users)
    .values(
      demoUsers.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        emailVerified: true,
        locale: 'en',
        timezone: 'Asia/Ho_Chi_Minh',
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(schema.workspaceMembers)
    .values(demoUsers.map((u) => ({ workspaceId: WORKSPACE_ID, userId: u.id })))
    .onConflictDoNothing();

  // role slug → id (roles were seeded earlier in seed()). Prefer the
  // workspace-owned editable copy over the global template so demo assignments
  // point at the row an admin can actually edit.
  const roleRows = await db
    .select({
      id: schema.systemRoles.id,
      slug: schema.systemRoles.slug,
      workspaceId: schema.systemRoles.workspaceId,
    })
    .from(schema.systemRoles)
    .where(
      or(isNull(schema.systemRoles.workspaceId), eq(schema.systemRoles.workspaceId, WORKSPACE_ID)),
    );
  const roleIdBySlug = new Map<string, string>();
  for (const r of roleRows) {
    if (r.workspaceId === WORKSPACE_ID || !roleIdBySlug.has(r.slug)) {
      roleIdBySlug.set(r.slug, r.id);
    }
  }

  const assign = async (
    userId: string,
    slug: SystemRoleSlug,
    scopeType: 'workspace' | 'project',
    scopeId: string,
  ): Promise<void> => {
    const roleId = roleIdBySlug.get(slug);
    if (!roleId) return;
    await db
      .insert(userRoleAssignments)
      .values({
        workspaceId: WORKSPACE_ID,
        userId,
        roleId,
        scopeType,
        scopeId,
        grantedBy: ADMIN_USER_ID,
      })
      .onConflictDoNothing();
  };

  // Workspace-wide roles → land in the JWT baseline for these users.
  await assign(PROJECT_ADMIN_ID, SYSTEM_ROLE.PROJECT_ADMIN, 'workspace', WORKSPACE_ID);
  await assign(WORKSPACE_MEMBER_ID, SYSTEM_ROLE.WORKSPACE_MEMBER, 'workspace', WORKSPACE_ID);

  // PBAC: Frank has NO workspace/global role — only project-scoped grants,
  // resolved per-request by getProjectPermissions(). project_admin on NXP,
  // project_viewer on MOB; every other project falls back to baseline only.
  const NXP_ID = SEED_PROJECTS[0].id;
  const MOB_ID = SEED_PROJECTS[1].id;
  await assign(PROJECT_LEAD_ID, SYSTEM_ROLE.PROJECT_ADMIN, 'project', NXP_ID);
  await assign(PROJECT_LEAD_ID, SYSTEM_ROLE.PROJECT_VIEWER, 'project', MOB_ID);

  // Make Frank an actual member of both projects (realism + assignee validity).
  await db
    .insert(projectMembers)
    .values([
      {
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: NXP_ID,
        userId: PROJECT_LEAD_ID,
        status: 'active',
      },
      {
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        projectId: MOB_ID,
        userId: PROJECT_LEAD_ID,
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  console.log('✅  RBAC/PBAC demo users seeded (project_admin, workspace_member, PBAC lead)');
}
