// Load .env for local dev; in CI the env vars are injected directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI mode */
}

/**
 * Seed script — creates the default workspace, platform-admin user (passwordless,
 * SSO-only), system roles + permission catalogue, default workflow for dev/test,
 * and sample projects that mirror the real business flow:
 *   project → counter → lead-as-project-member → workflow statuses
 *
 * Run standalone : pnpm db:seed
 * Called by      : db/migrate.ts when SEED_ON_DEPLOY=true (develop env only)
 * Idempotent — safe to run multiple times. Refuses to run in production unless
 * SEED_ON_DEPLOY=true (develop runs with NODE_ENV=production but opts in).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgOptions } from '../pg-ssl';
import { uuidv7 } from 'uuidv7';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
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
  releaseDailySnapshots,
  iterationDailySnapshots,
  comments,
  labels,
  workItemLabels,
  timeLogs,
  workItemWatchers,
} from '../schema/work';
import { userRoleAssignments } from '../schema/access';
import { workspaceSettings } from '../schema/workspace';
import { ssoConnections } from '../schema/identity';
import {
  ROLE_PERMISSIONS,
  ROLE_NAMES,
  SYSTEM_ROLE,
  PRESET_WORKSPACE_ROLES,
  type SystemRoleSlug,
} from '../permissions.catalog';
// Inlined from libs/modules/projects/src/domain/project.constants.ts
// so the migrator Docker image (which doesn't include libs/) can run this seed.
const DEFAULT_WORKFLOW_STATUSES = [
  { name: 'Defined', category: 'to_do' as const, color: '#6B7280', position: 0, isDefault: true },
  {
    name: 'In Progress',
    category: 'in_progress' as const,
    color: '#3B82F6',
    position: 1,
    isDefault: false,
  },
  { name: 'Completed', category: 'done' as const, color: '#10B981', position: 2, isDefault: false },
  { name: 'Accepted', category: 'done' as const, color: '#059669', position: 3, isDefault: false },
] as const;

// Assigned inside seed() before any helper function runs.

function getDeterministicRank(itemKey: string): string {
  const match = itemKey.match(/\d+/);
  if (!match) return 'a0000';
  return 'a' + match[0].padStart(4, '0');
}

let db: ReturnType<typeof drizzle<typeof schema>>;

// Fixed UUIDs ensure idempotency — same rows on every seed run.
const ADMIN_USER_ID = '00000000-0000-7000-8000-000000000002';
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000003';
const DEVELOPER_ID = '00000000-0000-7000-8000-000000000020';
const VIEWER_ID = '00000000-0000-7000-8000-000000000021';

// RBAC/PBAC demo users — one per otherwise-uncovered system role, plus a
// project-scoped "lead" that proves per-project (PBAC) differentiation.
const PROJECT_ADMIN_ID = '00000000-0000-7000-8000-000000000022';
const WORKSPACE_MEMBER_ID = '00000000-0000-7000-8000-000000000023';
const PROJECT_LEAD_ID = '00000000-0000-7000-8000-000000000025';

const NXP_STORY_1_ID = '00000000-0000-7000-8000-000000000030';
const NXP_STORY_2_ID = '00000000-0000-7000-8000-000000000031';
const MOB_STORY_1_ID = '00000000-0000-7000-8000-000000000032';

// ── Phase 2 fixed IDs ────────────────────────────────────────────────────────
const TEAM_ALPHA_ID = '00000000-0000-7000-8000-000000000040';
const TEAM_BETA_ID = '00000000-0000-7000-8000-000000000041';

// NXP releases
const NXP_RELEASE_1_ID = '00000000-0000-7000-8000-000000000050';
const NXP_RELEASE_2_ID = '00000000-0000-7000-8000-000000000051';

// NXP iterations (Sprint 26.1 = committed, Sprint 26.2 = planning, Sprint 25.4 = accepted)
const NXP_ITER_PREV_ID = '00000000-0000-7000-8000-000000000060'; // accepted
const NXP_ITER_CURRENT_ID = '00000000-0000-7000-8000-000000000061'; // committed ← active
const NXP_ITER_NEXT_ID = '00000000-0000-7000-8000-000000000062'; // planning

// MOB iterations
const MOB_ITER_CURRENT_ID = '00000000-0000-7000-8000-000000000063'; // committed

// Additional NXP work items with richer data
const NXP_STORY_7_ID = '00000000-0000-7000-8000-000000000070';
const NXP_STORY_8_ID = '00000000-0000-7000-8000-000000000071';
const NXP_STORY_9_ID = '00000000-0000-7000-8000-000000000072';
const NXP_STORY_10_ID = '00000000-0000-7000-8000-000000000073';
const NXP_DEFECT_11_ID = '00000000-0000-7000-8000-000000000074';

// Feature parent + child defects that demo the Feature / Defects / Defect Status columns.
const NXP_FEATURE_ID = '00000000-0000-7000-8000-000000000075';
const NXP_CHILD_DEFECT_1_ID = '00000000-0000-7000-8000-000000000076'; // child of US-5 (closed)
const NXP_CHILD_DEFECT_2_ID = '00000000-0000-7000-8000-000000000077'; // child of US-6 (open)
const NXP_CHILD_DEFECT_3_ID = '00000000-0000-7000-8000-000000000078'; // child of US-6 (closed)

// ── Seed data constants ───────────────────────────────────────────────────────
// Format: { id, key, name, description }
// All are owned by ADMIN_USER_ID and belong to the default workspace.
const SEED_PROJECTS = [
  {
    id: '00000000-0000-7000-8000-000000000010',
    key: 'NXP',
    name: 'NX Platform',
    description: 'Core NX mono-repo platform upgrades and tooling improvements.',
  },
  {
    id: '00000000-0000-7000-8000-000000000011',
    key: 'MOB',
    name: 'Mobile App',
    description: 'Cross-platform React Native application for iOS and Android.',
  },
  {
    id: '00000000-0000-7000-8000-000000000012',
    key: 'OPS',
    name: 'DevOps & Infrastructure',
    description: 'CI/CD pipelines, cloud infrastructure, and observability stack.',
  },
  {
    id: '00000000-0000-7000-8000-000000000013',
    key: 'LEG',
    name: 'Legacy Migration',
    description: 'Incremental migration of legacy monolith services to micro-services.',
  },
  {
    id: '00000000-0000-7000-8000-000000000014',
    key: 'PRT',
    name: 'Partner Portal',
    description: 'Self-service portal for external partners and API consumers.',
  },
] as const;

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

// ── Seed work items ───────────────────────────────────────────────────────────
// Realistic enterprise-style backlog for the first two projects.
// Idempotent: uses onConflictDoNothing on the unique (projectId, itemKey) index.
async function seedWorkItems() {
  // Helper: look up status IDs by project + workflow category
  async function getStatuses(projectId: string) {
    const rows = await db
      .select({
        id: schema.workflowStatuses.id,
        category: schema.workflowStatuses.category,
        position: schema.workflowStatuses.position,
      })
      .from(schema.workflowStatuses)
      .where(eq(schema.workflowStatuses.projectId, projectId))
      .orderBy(schema.workflowStatuses.position);

    return {
      todo: rows.find((r) => r.category === 'to_do')?.id,
      inProgress: rows.find((r) => r.category === 'in_progress')?.id,
      done: rows.find((r) => r.category === 'done')?.id,
    };
  }

  // ── NXP: NX Platform ───────────────────────────────────────────────────
  const nxpId = SEED_PROJECTS[0].id;
  const nxp = await getStatuses(nxpId);
  if (nxp.todo && nxp.inProgress && nxp.done) {
    const nxpItems = [
      // Stories
      {
        id: NXP_STORY_1_ID,
        itemKey: 'US-1',
        type: 'story' as const,
        title: 'Upgrade NX workspace to v21',
        statusId: nxp.inProgress,
        scheduleState: 'in_progress' as const,
        priority: 'high' as const,
        storyPoints: '5',
        assigneeId: ADMIN_USER_ID,
      },
      {
        id: NXP_STORY_2_ID,
        itemKey: 'US-2',
        type: 'story' as const,
        title: 'Integrate Storybook 8 into shared UI library',
        statusId: nxp.todo,
        scheduleState: 'defined' as const,
        priority: 'normal' as const,
        storyPoints: '3',
        assigneeId: DEVELOPER_ID,
      },
      // Defect
      {
        id: uuidv7(),
        itemKey: 'DE-1',
        type: 'defect' as const,
        title: 'CI pipeline fails intermittently on Windows build agents',
        statusId: nxp.inProgress,
        scheduleState: 'in_progress' as const,
        priority: 'urgent' as const,
        assigneeId: ADMIN_USER_ID,
      },
      // Feature
      {
        id: NXP_FEATURE_ID,
        itemKey: 'FE-1',
        type: 'feature' as const,
        title: 'Shared ESLint flat-config across all apps',
        statusId: nxp.todo,
        scheduleState: 'defined' as const,
        priority: 'normal' as const,
        storyPoints: '8',
        assigneeId: DEVELOPER_ID,
      },
    ];

    for (const item of nxpItems) {
      await db
        .insert(workItems)
        .values({
          ...item,
          workspaceId: WORKSPACE_ID,
          projectId: nxpId,
          createdBy: ADMIN_USER_ID,
          rank: getDeterministicRank(item.itemKey),
        })
        .onConflictDoNothing();
    }
    // Seed tasks into the separate tasks table
    const nxpTasks = [
      {
        id: '00000000-0000-7000-8000-000000000034' as const,
        title: 'Update workspace.json for NX v21 breaking changes',
        state: 'completed' as const,
        parentId: NXP_STORY_1_ID,
        assigneeId: DEVELOPER_ID,
        estimateHours: '2',
        actualHours: '1.5',
      },
      {
        id: '00000000-0000-7000-8000-000000000035' as const,
        title: 'Validate all affected generators after upgrade',
        state: 'in_progress' as const,
        parentId: NXP_STORY_1_ID,
        assigneeId: ADMIN_USER_ID,
        estimateHours: '3',
        todoHours: '2',
      },
    ];
    for (let i = 0; i < nxpTasks.length; i++) {
      const t = nxpTasks[i];
      await db
        .insert(tasks)
        .values({
          ...t,
          workspaceId: WORKSPACE_ID,
          projectId: nxpId,
          itemKey: `TA-${i + 1}`,
          rank: getDeterministicRank(`TA-${i + 1}`),
          createdBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }
    // Update per-type counters
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 2)` })
      .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'story')));
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 1)` })
      .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'defect')));
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 1)` })
      .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'feature')));
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, ${nxpTasks.length})` })
      .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'task')));
  }

  // ── MOB: Mobile App ────────────────────────────────────────────────────
  const mobId = SEED_PROJECTS[1].id;
  const mob = await getStatuses(mobId);
  if (mob.todo && mob.inProgress && mob.done) {
    const mobItems = [
      {
        id: MOB_STORY_1_ID,
        itemKey: 'US-1',
        type: 'story' as const,
        title: 'Implement biometric authentication (Face ID / Fingerprint)',
        statusId: mob.todo,
        scheduleState: 'defined' as const,
        priority: 'high' as const,
        storyPoints: '8',
        assigneeId: ADMIN_USER_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'US-2',
        type: 'story' as const,
        title: 'Dark mode support across all screens',
        statusId: mob.inProgress,
        scheduleState: 'in_progress' as const,
        priority: 'normal' as const,
        storyPoints: '5',
        assigneeId: DEVELOPER_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'DE-1',
        type: 'defect' as const,
        title: 'App crashes on Android 14 when rotating to landscape on Home screen',
        statusId: mob.todo,
        scheduleState: 'defined' as const,
        priority: 'urgent' as const,
        assigneeId: DEVELOPER_ID,
      },
    ];

    for (const item of mobItems) {
      await db
        .insert(workItems)
        .values({
          ...item,
          workspaceId: WORKSPACE_ID,
          projectId: mobId,
          createdBy: ADMIN_USER_ID,
          rank: getDeterministicRank(item.itemKey),
        })
        .onConflictDoNothing();
    }
    // Seed tasks into the separate tasks table
    const mobTasks = [
      {
        id: '00000000-0000-7000-8000-000000000036' as const,
        title: 'Integrate expo-local-authentication SDK',
        state: 'defined' as const,
        parentId: MOB_STORY_1_ID,
        estimateHours: '4',
        todoHours: '4',
      },
    ];
    for (let i = 0; i < mobTasks.length; i++) {
      const t = mobTasks[i];
      await db
        .insert(tasks)
        .values({
          ...t,
          workspaceId: WORKSPACE_ID,
          projectId: mobId,
          itemKey: `TA-${i + 1}`,
          rank: getDeterministicRank(`TA-${i + 1}`),
          createdBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 2)` })
      .where(and(eq(projectCounters.projectId, mobId), eq(projectCounters.itemType, 'story')));
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 1)` })
      .where(and(eq(projectCounters.projectId, mobId), eq(projectCounters.itemType, 'defect')));
  }

  console.log('✅  Work items seeded');
}

// ── Phase 2: Teams ───────────────────────────────────────────────────────────
async function seedTeams() {
  await db
    .insert(teams)
    .values([
      {
        id: TEAM_ALPHA_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Team Alpha',
        key: 'ALPHA',
        description: 'Core platform team — owns NX Platform and DevOps projects.',
        leadId: ADMIN_USER_ID,
        status: 'active',
      },
      {
        id: TEAM_BETA_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Team Beta',
        key: 'BETA',
        description: 'Product team — owns Mobile App and Partner Portal.',
        leadId: DEVELOPER_ID,
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // Team members
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
      // Additional Team Alpha members with no tasks this iteration — exercises
      // the Team Status roster (zero-task members render with an empty load bar).
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
      {
        id: '00000000-0000-7000-8000-000000000082',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_BETA_ID,
        userId: DEVELOPER_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000083',
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_BETA_ID,
        userId: VIEWER_ID,
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // Link teams to their projects (project_teams). Iterations carry a team_id and
  // creating a work item into an iteration validates the team is linked to the
  // project (assertTeamLinked) — without these links, "Add Item" fails with
  // "Team is not linked to this project". Alpha → NXP/OPS, Beta → MOB/PRT.
  const NXP = SEED_PROJECTS[0].id; // NX Platform
  const MOB = SEED_PROJECTS[1].id; // Mobile App
  const OPS = SEED_PROJECTS[2].id; // DevOps & Infrastructure
  const PRT = SEED_PROJECTS[4].id; // Partner Portal
  await db
    .insert(projectTeams)
    .values([
      {
        id: '00000000-0000-7000-8000-000000000090',
        workspaceId: WORKSPACE_ID,
        projectId: NXP,
        teamId: TEAM_ALPHA_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000091',
        workspaceId: WORKSPACE_ID,
        projectId: OPS,
        teamId: TEAM_ALPHA_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000092',
        workspaceId: WORKSPACE_ID,
        projectId: MOB,
        teamId: TEAM_BETA_ID,
        status: 'active',
      },
      {
        id: '00000000-0000-7000-8000-000000000093',
        workspaceId: WORKSPACE_ID,
        projectId: PRT,
        teamId: TEAM_BETA_ID,
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  console.log('✅  Teams seeded');
}

// ── Phase 1+2: Releases ──────────────────────────────────────────────────────
async function seedReleases() {
  const nxpId = SEED_PROJECTS[0].id;
  const mobId = SEED_PROJECTS[1].id;

  await db
    .insert(releases)
    .values([
      // NXP releases
      {
        id: NXP_RELEASE_1_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        name: 'v2.0 — NX Platform Upgrade',
        description: 'Major upgrade to NX v21 + ESLint flat-config rollout.',
        status: 'planning',
        releaseDate: '2026-07-31',
      },
      {
        id: NXP_RELEASE_2_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        name: 'v2.1 — Storybook & DX',
        description: 'Storybook 8 integration and developer experience improvements.',
        status: 'planning',
        releaseDate: '2026-08-31',
      },
      // MOB release
      {
        id: '00000000-0000-7000-8000-000000000052',
        workspaceId: WORKSPACE_ID,
        projectId: mobId,
        name: 'v1.5 — Auth & Accessibility',
        description: 'Biometric auth, dark mode, and accessibility fixes.',
        status: 'planning',
        releaseDate: '2026-08-15',
      },
    ])
    .onConflictDoNothing();

  console.log('✅  Releases seeded');
}

// ── Phase 2: Iterations ──────────────────────────────────────────────────────
async function seedIterations() {
  const nxpId = SEED_PROJECTS[0].id;
  const mobId = SEED_PROJECTS[1].id;

  await db
    .insert(iterations)
    .values([
      // ── NXP iterations (3 sprints — past / current / next) ──────────────────
      {
        id: NXP_ITER_PREV_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        teamId: TEAM_ALPHA_ID,
        iterationKey: 'IT-1',
        name: 'Sprint 25.4',
        goal: 'Complete legacy migration phase 1 and stabilise CI pipeline.',
        theme: 'Stability & Foundation',
        state: 'accepted',
        plannedVelocity: 20,
        startDate: '2026-06-02',
        endDate: '2026-06-13',
      },
      {
        id: NXP_ITER_CURRENT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        teamId: TEAM_ALPHA_ID,
        iterationKey: 'IT-2',
        name: 'Sprint 26.1',
        goal: 'Ship NX v21 upgrade and ESLint flat-config across all apps.',
        theme: 'NX Platform Modernisation',
        notes: 'Carry-over: NXP-5 validation task still in-progress from last sprint.',
        state: 'committed',
        plannedVelocity: 21,
        startDate: '2026-06-16',
        endDate: '2026-06-27',
      },
      {
        id: NXP_ITER_NEXT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        teamId: TEAM_ALPHA_ID,
        iterationKey: 'IT-3',
        name: 'Sprint 26.2',
        goal: 'Storybook 8 integration and shared component library documentation.',
        theme: 'Developer Experience',
        state: 'planning',
        plannedVelocity: 18,
        startDate: '2026-06-30',
        endDate: '2026-07-11',
      },
      // ── MOB iteration (current sprint) ──────────────────────────────────────
      {
        id: MOB_ITER_CURRENT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: mobId,
        teamId: TEAM_BETA_ID,
        iterationKey: 'IT-1',
        name: 'Sprint 26.1',
        goal: 'Biometric auth + dark mode groundwork.',
        state: 'committed',
        plannedVelocity: 13,
        startDate: '2026-06-16',
        endDate: '2026-06-27',
      },
    ])
    .onConflictDoNothing();

  console.log('✅  Iterations seeded');
}

// ── Phase 1+2: Extended NXP work items (with releases + iterations) ──────────
async function seedExtendedWorkItems() {
  const nxpId = SEED_PROJECTS[0].id;
  const mobId = SEED_PROJECTS[1].id;

  // Get NXP status IDs
  const nxpStatuses = await db
    .select({ id: schema.workflowStatuses.id, category: schema.workflowStatuses.category })
    .from(schema.workflowStatuses)
    .where(eq(schema.workflowStatuses.projectId, nxpId));

  const nxpTodo = nxpStatuses.find((s) => s.category === 'to_do')?.id;
  const nxpInProgress = nxpStatuses.find((s) => s.category === 'in_progress')?.id;
  const nxpDone = nxpStatuses.find((s) => s.category === 'done')?.id;

  const mobStatuses = await db
    .select({ id: schema.workflowStatuses.id, category: schema.workflowStatuses.category })
    .from(schema.workflowStatuses)
    .where(eq(schema.workflowStatuses.projectId, mobId));

  const mobTodo = mobStatuses.find((s) => s.category === 'to_do')?.id;
  const mobInProgress = mobStatuses.find((s) => s.category === 'in_progress')?.id;

  if (!nxpTodo || !nxpInProgress || !nxpDone) return;

  // NXP items: assigned to current sprint + release, varied states
  const nxpExtended = [
    // Iteration-assigned stories (Sprint 26.1 — committed)
    {
      id: NXP_STORY_7_ID,
      itemKey: 'US-5',
      type: 'story' as const,
      title: 'Migrate all apps to ESLint flat-config',
      statusId: nxpInProgress,
      scheduleState: 'in_progress' as const,
      priority: 'high' as const,
      storyPoints: '5',
      assigneeId: ADMIN_USER_ID,
      parentId: NXP_FEATURE_ID,
      iterationId: NXP_ITER_CURRENT_ID,
      releaseId: NXP_RELEASE_1_ID,
    },
    {
      id: NXP_STORY_8_ID,
      itemKey: 'US-6',
      type: 'story' as const,
      title: 'Enforce strict TypeScript settings across workspace',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'normal' as const,
      storyPoints: '3',
      assigneeId: DEVELOPER_ID,
      parentId: NXP_FEATURE_ID,
      isBlocked: true,
      blockedReason: 'Waiting on upstream API contract from Platform team',
      iterationId: NXP_ITER_CURRENT_ID,
      releaseId: NXP_RELEASE_1_ID,
    },
    {
      id: NXP_STORY_9_ID,
      itemKey: 'US-7',
      type: 'story' as const,
      title: 'Add Storybook 8 to component library',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'normal' as const,
      storyPoints: '8',
      assigneeId: DEVELOPER_ID,
      iterationId: NXP_ITER_NEXT_ID,
      releaseId: NXP_RELEASE_2_ID,
    },
    // Accepted item (from previous sprint)
    {
      id: NXP_STORY_10_ID,
      itemKey: 'US-8',
      type: 'story' as const,
      title: 'Setup shared tsconfig base with path aliases',
      statusId: nxpDone,
      scheduleState: 'accepted' as const,
      priority: 'high' as const,
      storyPoints: '3',
      assigneeId: ADMIN_USER_ID,
      iterationId: NXP_ITER_PREV_ID,
      releaseId: NXP_RELEASE_1_ID,
    },
    // Defect in current sprint
    {
      id: NXP_DEFECT_11_ID,
      itemKey: 'DE-2',
      type: 'defect' as const,
      title: 'ESLint rule conflicts between root and app-level configs',
      statusId: nxpInProgress,
      scheduleState: 'in_progress' as const,
      priority: 'urgent' as const,
      assigneeId: ADMIN_USER_ID,
      iterationId: NXP_ITER_CURRENT_ID,
    },
    // Child defects (rollup only — no iteration, so they surface as Defects /
    // Defect Status counts on their parent story rather than as their own rows).
    {
      id: NXP_CHILD_DEFECT_1_ID,
      itemKey: 'DE-3',
      type: 'defect' as const,
      title: 'Flat-config migration breaks the legacy import/order rule',
      statusId: nxpDone,
      scheduleState: 'accepted' as const,
      priority: 'normal' as const,
      assigneeId: ADMIN_USER_ID,
      parentId: NXP_STORY_7_ID,
    },
    {
      id: NXP_CHILD_DEFECT_2_ID,
      itemKey: 'DE-4',
      type: 'defect' as const,
      title: 'noUncheckedIndexedAccess surfaces 40+ latent nulls',
      statusId: nxpInProgress,
      scheduleState: 'in_progress' as const,
      priority: 'high' as const,
      assigneeId: DEVELOPER_ID,
      parentId: NXP_STORY_8_ID,
    },
    {
      id: NXP_CHILD_DEFECT_3_ID,
      itemKey: 'DE-5',
      type: 'defect' as const,
      title: 'strictNullChecks regression in the shared logger',
      statusId: nxpDone,
      scheduleState: 'accepted' as const,
      priority: 'normal' as const,
      assigneeId: DEVELOPER_ID,
      parentId: NXP_STORY_8_ID,
    },
    // Backlog items (no iteration)
    {
      id: uuidv7(),
      itemKey: 'US-9',
      type: 'story' as const,
      title: 'Automate dependency graph visualisation in CI',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'low' as const,
      storyPoints: '5',
      assigneeId: DEVELOPER_ID,
    },
    {
      id: uuidv7(),
      itemKey: 'US-10',
      type: 'story' as const,
      title: 'Integrate Chromatic for visual regression testing',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'normal' as const,
      storyPoints: '5',
      releaseId: NXP_RELEASE_2_ID,
    },
  ];

  for (const item of nxpExtended) {
    await db
      .insert(workItems)
      .values({
        ...item,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        createdBy: ADMIN_USER_ID,
        rank: getDeterministicRank(item.itemKey),
      })
      .onConflictDoNothing();
  }

  // Update per-type counters for extended items
  await db
    .update(projectCounters)
    .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 10)` })
    .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'story')));
  await db
    .update(projectCounters)
    .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 5)` })
    .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'defect')));

  // Converge the Feature parent link for the two current-sprint stories.
  // The insert above is skipped (onConflictDoNothing) when the rows already
  // exist, so set parentId explicitly — resolved by itemKey so it works whether
  // the feature row carries the seed's fixed id or a pre-existing one.
  const nxpFeature = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.projectId, nxpId), eq(workItems.itemKey, 'FE-1')))
    .limit(1);
  if (nxpFeature[0]) {
    await db
      .update(workItems)
      .set({ parentId: nxpFeature[0].id })
      .where(inArray(workItems.id, [NXP_STORY_7_ID, NXP_STORY_8_ID]));
  }

  // Child tasks for the two current-sprint stories so the Tasks % column renders
  // a real completion bar (rollup of task estimate vs. remaining to-do hours).
  const nxpExtendedTasks = [
    {
      id: '00000000-0000-7000-8000-000000000079' as const,
      title: 'Rewrite root eslint config as flat config',
      state: 'completed' as const,
      parentId: NXP_STORY_7_ID,
      assigneeId: ADMIN_USER_ID,
      estimateHours: '5',
      todoHours: '0',
      actualHours: '5',
    },
    {
      id: '00000000-0000-7000-8000-00000000007a' as const,
      title: 'Migrate per-app overrides',
      state: 'in_progress' as const,
      parentId: NXP_STORY_7_ID,
      assigneeId: DEVELOPER_ID,
      estimateHours: '3',
      todoHours: '2',
    },
    {
      id: '00000000-0000-7000-8000-00000000007b' as const,
      title: 'Turn on strict compiler flags',
      state: 'defined' as const,
      parentId: NXP_STORY_8_ID,
      assigneeId: DEVELOPER_ID,
      estimateHours: '4',
      todoHours: '4',
    },
  ];
  for (let i = 0; i < nxpExtendedTasks.length; i++) {
    const t = nxpExtendedTasks[i];
    const itemKey = `TA-${i + 3}`;
    await db
      .insert(tasks)
      .values({
        ...t,
        workspaceId: WORKSPACE_ID,
        projectId: nxpId,
        itemKey,
        rank: getDeterministicRank(itemKey),
        createdBy: ADMIN_USER_ID,
      })
      .onConflictDoNothing();
  }
  await db
    .update(projectCounters)
    .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 5)` })
    .where(and(eq(projectCounters.projectId, nxpId), eq(projectCounters.itemType, 'task')));

  // MOB extended items (with iteration)
  if (mobTodo && mobInProgress) {
    const mobExtended = [
      {
        id: uuidv7(),
        itemKey: 'US-3',
        type: 'story' as const,
        title: 'Implement Face ID login flow (iOS)',
        statusId: mobInProgress,
        scheduleState: 'in_progress' as const,
        priority: 'high' as const,
        storyPoints: '5',
        assigneeId: DEVELOPER_ID,
        iterationId: MOB_ITER_CURRENT_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'US-4',
        type: 'story' as const,
        title: 'Dark mode — apply theme tokens to navigation screens',
        statusId: mobTodo,
        scheduleState: 'defined' as const,
        priority: 'normal' as const,
        storyPoints: '3',
        assigneeId: DEVELOPER_ID,
        iterationId: MOB_ITER_CURRENT_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'DE-2',
        type: 'defect' as const,
        title: 'Push notifications not delivered on iOS 18.1 background state',
        statusId: mobTodo,
        scheduleState: 'defined' as const,
        priority: 'high' as const,
        assigneeId: ADMIN_USER_ID,
        iterationId: MOB_ITER_CURRENT_ID,
      },
    ];

    for (const item of mobExtended) {
      await db
        .insert(workItems)
        .values({
          ...item,
          workspaceId: WORKSPACE_ID,
          projectId: mobId,
          createdBy: ADMIN_USER_ID,
          rank: getDeterministicRank(item.itemKey),
        })
        .onConflictDoNothing();
    }

    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 4)` })
      .where(and(eq(projectCounters.projectId, mobId), eq(projectCounters.itemType, 'story')));
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 2)` })
      .where(and(eq(projectCounters.projectId, mobId), eq(projectCounters.itemType, 'defect')));
  }

  console.log('✅  Extended work items seeded (with releases + iterations)');
}

// ── Activity logs (Revision History) ─────────────────────────────────────────
// Inserts realistic activity entries for fixed-ID work items so the
// "Revision History" tab is not empty in demo / dev environments.
async function seedActivityLogs() {
  // Idempotency guard — skip if already seeded for NXP-1.
  const existing = await db
    .select({ id: schema.activityLogs.id })
    .from(schema.activityLogs)
    .where(eq(schema.activityLogs.workItemId, NXP_STORY_1_ID))
    .limit(1);
  if (existing.length > 0) return;

  const NXP = SEED_PROJECTS[0].id;
  const MOB = SEED_PROJECTS[1].id;
  const W = WORKSPACE_ID;

  type ActivityRow = typeof schema.activityLogs.$inferInsert;

  const rows: ActivityRow[] = [
    // NXP-1
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_1_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_1_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.created',
      changes: null,
      metadata: { title: 'Upgrade NX to v21 and apply migrations', type: 'story' },
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_1_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_1_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.assigned',
      changes: { field: 'assigneeId', old: null, new: DEVELOPER_ID },
      metadata: {},
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_1_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_1_ID,
      actorId: DEVELOPER_ID,
      action: 'work_item.schedule_state_changed',
      changes: { field: 'scheduleState', old: 'defined', new: 'in_progress' },
      metadata: {},
    },
    // NXP-2
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_2_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_2_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.created',
      changes: null,
      metadata: { title: 'Replace tslint with ESLint workspace-wide', type: 'story' },
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_2_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_2_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.priority_changed',
      changes: { field: 'priority', old: 'normal', new: 'high' },
      metadata: {},
    },
    // MOB-1
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: MOB,
      workItemId: MOB_STORY_1_ID,
      entityType: 'work_item',
      entityId: MOB_STORY_1_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.created',
      changes: null,
      metadata: { title: 'Scaffold React Native project with Expo 51', type: 'story' },
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: MOB,
      workItemId: MOB_STORY_1_ID,
      entityType: 'work_item',
      entityId: MOB_STORY_1_ID,
      actorId: DEVELOPER_ID,
      action: 'work_item.assigned',
      changes: { field: 'assigneeId', old: null, new: DEVELOPER_ID },
      metadata: {},
    },
    // NXP-7
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_7_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_7_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.created',
      changes: null,
      metadata: { title: 'Migrate all apps to ESLint flat-config', type: 'story' },
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_7_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_7_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.assigned',
      changes: { field: 'assigneeId', old: null, new: ADMIN_USER_ID },
      metadata: {},
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_7_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_7_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.flow_state_changed',
      changes: { field: 'statusId', old: null, new: 'in_progress' },
      metadata: { statusName: 'In Progress' },
    },
    // NXP-8
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_8_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_8_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.created',
      changes: null,
      metadata: { title: 'Enforce strict TypeScript settings across workspace', type: 'story' },
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_8_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_8_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.assigned',
      changes: { field: 'assigneeId', old: null, new: DEVELOPER_ID },
      metadata: {},
    },
    // NXP-10 (accepted — show full lifecycle)
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_10_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_10_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.created',
      changes: null,
      metadata: { title: 'Setup shared tsconfig base with path aliases', type: 'story' },
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_10_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_10_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.assigned',
      changes: { field: 'assigneeId', old: null, new: ADMIN_USER_ID },
      metadata: {},
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_10_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_10_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.schedule_state_changed',
      changes: { field: 'scheduleState', old: 'defined', new: 'in_progress' },
      metadata: {},
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_STORY_10_ID,
      entityType: 'work_item',
      entityId: NXP_STORY_10_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.schedule_state_changed',
      changes: { field: 'scheduleState', old: 'in_progress', new: 'accepted' },
      metadata: {},
    },
    // NXP-11 (urgent defect)
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_DEFECT_11_ID,
      entityType: 'work_item',
      entityId: NXP_DEFECT_11_ID,
      actorId: DEVELOPER_ID,
      action: 'work_item.created',
      changes: null,
      metadata: {
        title: 'ESLint rule conflicts between root and app-level configs',
        type: 'defect',
      },
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_DEFECT_11_ID,
      entityType: 'work_item',
      entityId: NXP_DEFECT_11_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.priority_changed',
      changes: { field: 'priority', old: 'normal', new: 'urgent' },
      metadata: {},
    },
    {
      id: uuidv7(),
      workspaceId: W,
      projectId: NXP,
      workItemId: NXP_DEFECT_11_ID,
      entityType: 'work_item',
      entityId: NXP_DEFECT_11_ID,
      actorId: ADMIN_USER_ID,
      action: 'work_item.assigned',
      changes: { field: 'assigneeId', old: null, new: ADMIN_USER_ID },
      metadata: {},
    },
  ];

  await db.insert(schema.activityLogs).values(rows);
  console.log(`✅  Activity logs seeded (${rows.length} entries)`);
}

// ── Phase 3: milestones, capacity, defect fields, burndown, collaboration ─────
// Fills the tables the Phase-3 surfaces read from so Milestones, Team Status,
// Quality/Defects, burndown charts, and collaboration all show demo data
// instead of empty states. Idempotent (fixed ids / onConflictDoNothing).
async function seedPhase3() {
  const NXP = SEED_PROJECTS[0].id;

  // 1. Workspace settings (defaults the Workspace Settings tab reads).
  await db
    .insert(workspaceSettings)
    .values({
      id: '00000000-0000-7000-8000-0000000000a0',
      workspaceId: WORKSPACE_ID,
      timezone: 'Asia/Ho_Chi_Minh',
      defaultLocale: 'en',
      dateFormat: 'YYYY-MM-DD',
    })
    .onConflictDoNothing();

  // 2. Defect fields — populate every seeded defect so the Quality board shows
  //    severity / state / root cause. NXP_DEFECT_11 gets a rich, fixed row.
  await db
    .update(workItems)
    .set({
      severity: 'major',
      foundInEnvironment: 'staging',
      rootCause: 'code',
      defectState: 'open',
    })
    .where(and(eq(workItems.workspaceId, WORKSPACE_ID), eq(workItems.type, 'defect')));
  await db
    .update(workItems)
    .set({
      severity: 'critical',
      foundInEnvironment: 'production',
      rootCause: 'integration',
      resolution: 'fixed',
      defectState: 'fixed',
      fixedInBuild: 'v2.0.0-rc3',
    })
    .where(eq(workItems.id, NXP_DEFECT_11_ID));

  // 3. Milestones for NX Platform, linked to its releases + owning project.
  const MS_1 = '00000000-0000-7000-8000-0000000000b0';
  const MS_2 = '00000000-0000-7000-8000-0000000000b1';
  await db
    .insert(milestones)
    .values([
      {
        id: MS_1,
        workspaceId: WORKSPACE_ID,
        projectId: NXP,
        name: 'GA — NX Platform v2',
        description: 'General availability of the v2 platform.',
        status: 'planned',
        ownerId: ADMIN_USER_ID,
        targetStartDate: '2026-07-01',
        targetEndDate: '2026-07-31',
      },
      {
        id: MS_2,
        workspaceId: WORKSPACE_ID,
        projectId: NXP,
        name: 'Hardening & Beta',
        description: 'Beta cut and a hardening pass before GA.',
        status: 'at_risk',
        ownerId: ADMIN_USER_ID,
        targetStartDate: '2026-08-01',
        targetEndDate: '2026-08-31',
      },
    ])
    .onConflictDoNothing();
  await db
    .insert(milestoneReleases)
    .values([
      { milestoneId: MS_1, releaseId: NXP_RELEASE_1_ID },
      { milestoneId: MS_2, releaseId: NXP_RELEASE_2_ID },
    ])
    .onConflictDoNothing();
  await db
    .insert(milestoneProjects)
    .values([
      { milestoneId: MS_1, projectId: NXP },
      { milestoneId: MS_2, projectId: NXP },
    ])
    .onConflictDoNothing();

  // Assign milestones directly to current-sprint stories so the Iteration
  // Status "Milestones" column renders (US-6 shows two → "+1" overflow).
  await db
    .insert(milestoneArtifacts)
    .values([
      { milestoneId: MS_1, workItemId: NXP_STORY_7_ID },
      { milestoneId: MS_1, workItemId: NXP_STORY_8_ID },
      { milestoneId: MS_2, workItemId: NXP_STORY_8_ID },
    ])
    .onConflictDoNothing();

  // 4. Member capacity — Team Alpha in the active NXP iteration (Team Status).
  await db
    .insert(memberCapacity)
    .values([
      {
        id: '00000000-0000-7000-8000-0000000000c0',
        workspaceId: WORKSPACE_ID,
        projectId: NXP,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        userId: ADMIN_USER_ID,
        capacityHours: '60',
      },
      {
        id: '00000000-0000-7000-8000-0000000000c1',
        workspaceId: WORKSPACE_ID,
        projectId: NXP,
        teamId: TEAM_ALPHA_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        userId: DEVELOPER_ID,
        capacityHours: '72',
      },
    ])
    .onConflictDoNothing();

  // 5. Burndown series — 5 daily snapshots for the active iteration + release 1.
  const burndown = [
    { d: '2026-06-22', total: 21, done: 0 },
    { d: '2026-06-23', total: 21, done: 3 },
    { d: '2026-06-24', total: 21, done: 8 },
    { d: '2026-06-25', total: 21, done: 13 },
    { d: '2026-06-26', total: 21, done: 16 },
  ];
  await db
    .insert(iterationDailySnapshots)
    .values(
      burndown.map((s) => ({
        id: uuidv7(),
        workspaceId: WORKSPACE_ID,
        iterationId: NXP_ITER_CURRENT_ID,
        snapshotDate: s.d,
        totalPoints: String(s.total),
        completedPoints: String(s.done),
        remainingPoints: String(s.total - s.done),
        totalItems: 5,
        completedItems: Math.round((s.done / s.total) * 5),
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(releaseDailySnapshots)
    .values(
      burndown.map((s) => ({
        id: uuidv7(),
        releaseId: NXP_RELEASE_1_ID,
        snapshotDate: s.d,
        totalPoints: String(s.total),
        completedPoints: String(s.done),
        remainingPoints: String(s.total - s.done),
        totalItems: 5,
        completedItems: Math.round((s.done / s.total) * 5),
      })),
    )
    .onConflictDoNothing();

  // 6. Labels (project-scoped) + a couple of assignments.
  const LBL_BUG = '00000000-0000-7000-8000-0000000000d0';
  const LBL_TD = '00000000-0000-7000-8000-0000000000d1';
  const LBL_UX = '00000000-0000-7000-8000-0000000000d2';
  await db
    .insert(labels)
    .values([
      { id: LBL_BUG, workspaceId: WORKSPACE_ID, projectId: NXP, name: 'bug', color: '#e5484d' },
      {
        id: LBL_TD,
        workspaceId: WORKSPACE_ID,
        projectId: NXP,
        name: 'tech-debt',
        color: '#f5a623',
      },
      { id: LBL_UX, workspaceId: WORKSPACE_ID, projectId: NXP, name: 'ux', color: '#3b82f6' },
    ])
    .onConflictDoNothing();
  await db
    .insert(workItemLabels)
    .values([
      { workItemId: NXP_DEFECT_11_ID, labelId: LBL_BUG },
      { workItemId: NXP_STORY_1_ID, labelId: LBL_UX },
      { workItemId: NXP_STORY_2_ID, labelId: LBL_TD },
    ])
    .onConflictDoNothing();

  // 7. Comments (one threaded reply) on a story + the flagship defect.
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
        workItemId: NXP_DEFECT_11_ID,
        authorId: DEVELOPER_ID,
        body: 'Reproduced on production; root cause is the integration retry path. Fix in rc3.',
      },
    ])
    .onConflictDoNothing();

  // 8. Time logs by the developer.
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
        description: 'API scaffolding + tests',
      },
      {
        id: '00000000-0000-7000-8000-0000000000f1',
        workspaceId: WORKSPACE_ID,
        workItemId: NXP_DEFECT_11_ID,
        userId: DEVELOPER_ID,
        loggedDate: '2026-06-25',
        hours: '2',
        description: 'Debug + fix retry path',
      },
    ])
    .onConflictDoNothing();

  // 9. Watchers.
  await db
    .insert(workItemWatchers)
    .values([
      { workItemId: NXP_STORY_1_ID, userId: ADMIN_USER_ID, workspaceId: WORKSPACE_ID },
      { workItemId: NXP_DEFECT_11_ID, userId: DEVELOPER_ID, workspaceId: WORKSPACE_ID },
    ])
    .onConflictDoNothing();

  console.log(
    '✅  Phase 3 seeded (2 milestones, capacity, defect fields, burndown, labels, comments, time logs, watchers)',
  );
}

/**
 * Seed the RBAC role catalogue (system_roles) into the given db handle.
 *
 * This is REFERENCE data — not demo fixtures. The backend @RequirePermission
 * decorators and the frontend gating derive their codes from the same catalogue
 * (db/permissions.catalog.ts), and JIT SSO provisioning assigns these role slugs
 * on first login. It must therefore exist in EVERY environment (dev, staging AND
 * production), independent of SEED_ON_DEPLOY. Idempotent: onConflictDoUpdate
 * backfills newly-granted permissions on re-run.
 */
async function seedSystemRolesInto(
  database: ReturnType<typeof drizzle<typeof schema>>,
): Promise<void> {
  const roleSlugs = Object.keys(ROLE_PERMISSIONS) as SystemRoleSlug[];
  for (const slug of roleSlugs) {
    const permissions = ROLE_PERMISSIONS[slug];
    const name = ROLE_NAMES[slug];
    await database
      .insert(schema.systemRoles)
      .values({
        name,
        slug,
        isSystem: true,
        permissions,
      })
      .onConflictDoUpdate({
        target: [schema.systemRoles.workspaceId, schema.systemRoles.slug],
        set: { permissions, name },
      });
  }
  console.log(`✅  System roles catalogue seeded (${roleSlugs.length} roles)`);
}

/**
 * Standalone entrypoint that seeds ONLY the reference role catalogue.
 * Safe to run on every deploy in every environment — including real production —
 * because it contains no demo fixtures (no workspace, users, projects, etc.).
 * Exported so db/migrate.ts can run it unconditionally after migrations.
 */
export async function seedSystemRoles(connectionUrl?: string): Promise<void> {
  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  const database = drizzle(pool, { schema });
  try {
    await seedSystemRolesInto(database);
  } finally {
    await pool.end();
  }
}

/**
 * Bootstrap the primary tenant — the workspace and its Entra SSO connection —
 * into the given db handle. This is prod-safe CONFIG (no demo fixtures): it is
 * what lets real users JIT-provision and lets a PLATFORM_ADMIN_EMAILS admin be
 * elevated on first SSO login. Driven entirely by env so the same routine runs
 * identically in dev, staging and production:
 *   BOOTSTRAP_WORKSPACE_NAME  — display name (default "ACME Corp")
 *   BOOTSTRAP_WORKSPACE_SLUG  — url slug     (default "main")
 *   ENTRA_TENANT_ID           — Entra directory to federate (skips SSO if unset)
 *   SSO_ALLOWED_EMAIL_DOMAINS — comma-separated JIT allow-list (default "qnsc.vn")
 * Idempotent: workspace + connection use onConflictDoUpdate so config edits
 * reconcile on every run.
 */
async function seedTenantBootstrapInto(
  database: ReturnType<typeof drizzle<typeof schema>>,
): Promise<void> {
  const workspaceName = process.env['BOOTSTRAP_WORKSPACE_NAME'] ?? 'ACME Corp';
  const workspaceSlug = process.env['BOOTSTRAP_WORKSPACE_SLUG'] ?? 'main';

  await database
    .insert(schema.workspaces)
    .values({ id: WORKSPACE_ID, slug: workspaceSlug, name: workspaceName })
    .onConflictDoUpdate({
      target: schema.workspaces.id,
      set: { name: workspaceName },
    });

  // Seed the BA job-function preset roles as EDITABLE workspace-scoped custom
  // roles (isSystem:false). onConflictDoNothing → created once, never clobbering
  // a workspace admin's later permission edits. See PRESET_WORKSPACE_ROLES.
  await database
    .insert(schema.systemRoles)
    .values(
      PRESET_WORKSPACE_ROLES.map((role) => ({
        workspaceId: WORKSPACE_ID,
        name: role.name,
        slug: role.slug,
        description: role.description,
        isSystem: false,
        permissions: role.permissions,
      })),
    )
    .onConflictDoNothing({
      target: [schema.systemRoles.workspaceId, schema.systemRoles.slug],
    });

  // Seed a per-workspace EDITABLE copy of every tier role EXCEPT Workspace Admin.
  // The four operational tiers (Project Admin / Member / Viewer, Workspace
  // Member) become ordinary workspace-owned roles (isSystem:false) so an admin
  // can tune their permissions without rewriting the shared global template.
  // Workspace Admin is deliberately omitted — it stays the single global,
  // immutable lockout anchor (isSystem:true) that guarantees a recovery path.
  const EDITABLE_TIER_SLUGS = [
    SYSTEM_ROLE.PROJECT_ADMIN,
    SYSTEM_ROLE.PROJECT_MEMBER,
    SYSTEM_ROLE.PROJECT_VIEWER,
    SYSTEM_ROLE.WORKSPACE_MEMBER,
  ] as const;
  await database
    .insert(schema.systemRoles)
    .values(
      EDITABLE_TIER_SLUGS.map((slug) => ({
        workspaceId: WORKSPACE_ID,
        name: ROLE_NAMES[slug],
        slug,
        isSystem: false,
        permissions: ROLE_PERMISSIONS[slug],
      })),
    )
    .onConflictDoNothing({
      target: [schema.systemRoles.workspaceId, schema.systemRoles.slug],
    });

  // Re-point any EXISTING assignment that still references a global tier
  // template onto this workspace's editable copy, so a workspace admin's later
  // permission edits actually take effect for already-provisioned users (and so
  // re-seeding never leaves a user holding both the template and the copy).
  // Idempotent: once re-pointed there are no template-scoped rows left to move.
  const tierRoleRows = await database
    .select({
      id: schema.systemRoles.id,
      slug: schema.systemRoles.slug,
      workspaceId: schema.systemRoles.workspaceId,
    })
    .from(schema.systemRoles)
    .where(inArray(schema.systemRoles.slug, [...EDITABLE_TIER_SLUGS]));
  for (const slug of EDITABLE_TIER_SLUGS) {
    const globalId = tierRoleRows.find((r) => r.slug === slug && r.workspaceId === null)?.id;
    const copyId = tierRoleRows.find((r) => r.slug === slug && r.workspaceId === WORKSPACE_ID)?.id;
    if (!globalId || !copyId) continue;
    // Drop template-scoped assignments that already have a copy twin (would
    // otherwise collide on the (user, role, scope) unique key), then move the rest.
    await database.execute(sql`
      DELETE FROM access.user_role_assignments a
      WHERE a.role_id = ${globalId}
        AND a.workspace_id = ${WORKSPACE_ID}
        AND EXISTS (
          SELECT 1 FROM access.user_role_assignments b
          WHERE b.user_id = a.user_id
            AND b.role_id = ${copyId}
            AND b.scope_type = a.scope_type
            AND b.scope_id IS NOT DISTINCT FROM a.scope_id
        )
    `);
    await database.execute(sql`
      UPDATE access.user_role_assignments
      SET role_id = ${copyId}
      WHERE role_id = ${globalId}
        AND workspace_id = ${WORKSPACE_ID}
    `);
  }

  const entraTid = process.env['ENTRA_TENANT_ID'];
  if (!entraTid) {
    console.log(
      `\u2705  Tenant bootstrap: workspace "${workspaceName}" + ${PRESET_WORKSPACE_ROLES.length} preset roles ` +
        `+ ${EDITABLE_TIER_SLUGS.length} editable tier roles ensured ` +
        `(no ENTRA_TENANT_ID \u2014 SSO connection skipped, dev-login only)`,
    );
    return;
  }

  // Restrict JIT provisioning to the corporate domain(s). Empty list = any
  // directory user could self-provision; default to qnsc.vn so only company
  // accounts auto-create. NOTE: only gates NEW users \u2014 already-linked SSO
  // identities skip the domain check on subsequent logins.
  const ssoAllowedDomains = (process.env['SSO_ALLOWED_EMAIL_DOMAINS'] ?? 'qnsc.vn')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  await database
    .insert(ssoConnections)
    .values({
      workspaceId: WORKSPACE_ID,
      provider: 'entra',
      externalTenantId: entraTid,
      defaultRoleSlug: 'project_member',
      allowedEmailDomains: ssoAllowedDomains,
      jitEnabled: true,
      status: 'active',
    })
    // Reconcile config on every run so allow-list / default-role / JIT changes
    // take effect on the existing connection.
    .onConflictDoUpdate({
      target: [ssoConnections.provider, ssoConnections.externalTenantId],
      set: {
        workspaceId: WORKSPACE_ID,
        defaultRoleSlug: 'project_member',
        allowedEmailDomains: ssoAllowedDomains,
        jitEnabled: true,
        status: 'active',
        updatedAt: new Date(),
      },
    });

  console.log(
    `\u2705  Tenant bootstrap: workspace "${workspaceName}" + ${PRESET_WORKSPACE_ROLES.length} preset roles ` +
      `+ ${EDITABLE_TIER_SLUGS.length} editable tier roles + Entra SSO connection ` +
      `reconciled (tid ${entraTid}, domains: ${ssoAllowedDomains.join(', ') || 'any'})`,
  );
}

/**
 * Standalone entrypoint that bootstraps ONLY the primary tenant (workspace + SSO
 * connection). Prod-safe — contains no demo fixtures. Exported so db/migrate.ts
 * can run it on real production deploys.
 */
export async function seedTenantBootstrap(connectionUrl?: string): Promise<void> {
  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  const database = drizzle(pool, { schema });
  try {
    await seedTenantBootstrapInto(database);
  } finally {
    await pool.end();
  }
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

    // ── Work items ────────────────────────────────────────────────────────────
    await seedWorkItems();

    // ── Phase 2: Teams ───────────────────────────────────────────────────────
    await seedTeams();

    // ── Phase 1+2: Releases ──────────────────────────────────────────────────
    await seedReleases();

    // ── Phase 2: Iterations ──────────────────────────────────────────────────
    await seedIterations();

    // ── Phase 1+2: Extended work items (releases + iterations assigned) ───────
    await seedExtendedWorkItems();

    // ── Revision history (activity logs for fixed-ID items) ──────────────────
    await seedActivityLogs();

    // ── Phase 3: milestones, capacity, defect fields, burndown, collaboration ─
    await seedPhase3();

    console.log(
      `✅  Seed complete — ${SEED_PROJECTS.length} projects, 6 users, 2 teams, 4 iterations, 3 releases, 2 milestones, work items + Phase 3 data seeded`,
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

// Run directly: pnpm db:seed
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
