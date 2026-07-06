// Load .env for local dev; in CI the env vars are injected directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI mode */
}

/**
 * Seed script — creates the first tenant, workspace, admin user,
 * system roles + permission catalogue, default workflow for dev/test,
 * and sample projects that mirror the real business flow:
 *   project → counter → lead-as-project-member → workflow statuses
 *
 * Run standalone : pnpm db:seed
 * Called by      : db/migrate.ts when SEED_ON_DEPLOY=true (develop env only)
 * Idempotent — safe to run multiple times.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgOptions } from '../pg-ssl';
import { uuidv7 } from 'uuidv7';
import * as argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../schema';
// Direct imports to avoid barrel tsx/CJS resolution edge cases at runtime.
import { projectCounters, projectMembers, workItems, iterations, releases, teams, teamMembers } from '../schema/work';
import { userRoleAssignments } from '../schema/access';
import { ssoConnections } from '../schema/identity';
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

let db: ReturnType<typeof drizzle<typeof schema>>;

// Fixed UUIDs ensure idempotency — same rows on every seed run.
const SYSTEM_TENANT_ID = '00000000-0000-7000-8000-000000000001';
const ADMIN_USER_ID = '00000000-0000-7000-8000-000000000002';
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000003';
const DEVELOPER_ID = '00000000-0000-7000-8000-000000000020';
const VIEWER_ID = '00000000-0000-7000-8000-000000000021';

const NXP_STORY_1_ID = '00000000-0000-7000-8000-000000000030';
const NXP_STORY_2_ID = '00000000-0000-7000-8000-000000000031';
const MOB_STORY_1_ID = '00000000-0000-7000-8000-000000000032';

// ── Phase 2 fixed IDs ────────────────────────────────────────────────────────
const TEAM_ALPHA_ID  = '00000000-0000-7000-8000-000000000040';
const TEAM_BETA_ID   = '00000000-0000-7000-8000-000000000041';

// NXP releases
const NXP_RELEASE_1_ID = '00000000-0000-7000-8000-000000000050';
const NXP_RELEASE_2_ID = '00000000-0000-7000-8000-000000000051';

// NXP iterations (Sprint 26.1 = committed, Sprint 26.2 = planning, Sprint 25.4 = accepted)
const NXP_ITER_PREV_ID    = '00000000-0000-7000-8000-000000000060'; // accepted
const NXP_ITER_CURRENT_ID = '00000000-0000-7000-8000-000000000061'; // committed ← active
const NXP_ITER_NEXT_ID    = '00000000-0000-7000-8000-000000000062'; // planning

// MOB iterations
const MOB_ITER_CURRENT_ID = '00000000-0000-7000-8000-000000000063'; // committed

// Additional NXP work items with richer data
const NXP_STORY_7_ID  = '00000000-0000-7000-8000-000000000070';
const NXP_STORY_8_ID  = '00000000-0000-7000-8000-000000000071';
const NXP_STORY_9_ID  = '00000000-0000-7000-8000-000000000072';
const NXP_STORY_10_ID = '00000000-0000-7000-8000-000000000073';
const NXP_DEFECT_11_ID = '00000000-0000-7000-8000-000000000074';

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
      tenantId: SYSTEM_TENANT_ID,
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
        and(eq(schema.projects.tenantId, SYSTEM_TENANT_ID), eq(schema.projects.key, project.key)),
      )
      .limit(1);
    actualId = existing[0]?.id;
  }
  if (!actualId) return; // should never happen

  // 2. Initialise the item-key counter (mirrors ProjectsService.createProject)
  await db
    .insert(schema.projectCounters)
    .values({ projectId: actualId, tenantId: SYSTEM_TENANT_ID, lastItemNumber: 0 })
    .onConflictDoNothing();

  // 3. Add the lead as the first active project member if not already present
  await db
    .insert(projectMembers)
    .values({
      id: uuidv7(),
      tenantId: SYSTEM_TENANT_ID,
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
          tenantId: SYSTEM_TENANT_ID,
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
        itemKey: 'NXP-1',
        type: 'story' as const,
        title: 'Upgrade NX workspace to v21',
        statusId: nxp.inProgress,
        scheduleState: 'in_progress' as const,
        priority: 'high' as const,
        storyPoints: 5,
        assigneeId: ADMIN_USER_ID,
      },
      {
        id: NXP_STORY_2_ID,
        itemKey: 'NXP-2',
        type: 'story' as const,
        title: 'Integrate Storybook 8 into shared UI library',
        statusId: nxp.todo,
        scheduleState: 'defined' as const,
        priority: 'normal' as const,
        storyPoints: 3,
        assigneeId: DEVELOPER_ID,
      },
      // Defect
      {
        id: uuidv7(),
        itemKey: 'NXP-3',
        type: 'defect' as const,
        title: 'CI pipeline fails intermittently on Windows build agents',
        statusId: nxp.inProgress,
        scheduleState: 'in_progress' as const,
        priority: 'urgent' as const,
        assigneeId: ADMIN_USER_ID,
      },
      // Tasks under NXP-1
      {
        id: uuidv7(),
        itemKey: 'NXP-4',
        type: 'task' as const,
        title: 'Update workspace.json for NX v21 breaking changes',
        statusId: nxp.done,
        scheduleState: 'completed' as const,
        priority: 'high' as const,
        parentId: NXP_STORY_1_ID,
        assigneeId: DEVELOPER_ID,
        estimateHours: '2',
        actualHours: '1.5',
      },
      {
        id: uuidv7(),
        itemKey: 'NXP-5',
        type: 'task' as const,
        title: 'Validate all affected generators after upgrade',
        statusId: nxp.inProgress,
        scheduleState: 'in_progress' as const,
        priority: 'high' as const,
        parentId: NXP_STORY_1_ID,
        assigneeId: ADMIN_USER_ID,
        estimateHours: '3',
        todoHours: '2',
      },
      // Feature
      {
        id: uuidv7(),
        itemKey: 'NXP-6',
        type: 'feature' as const,
        title: 'Shared ESLint flat-config across all apps',
        statusId: nxp.todo,
        scheduleState: 'defined' as const,
        priority: 'normal' as const,
        storyPoints: 8,
        assigneeId: DEVELOPER_ID,
      },
    ];

    for (const item of nxpItems) {
      await db
        .insert(workItems)
        .values({
          ...item,
          tenantId: SYSTEM_TENANT_ID,
          projectId: nxpId,
          createdBy: ADMIN_USER_ID,
          rank: item.itemKey, // deterministic rank for seeded items
        })
        .onConflictDoNothing();
    }
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, ${nxpItems.length})` })
      .where(eq(projectCounters.projectId, nxpId));
  }

  // ── MOB: Mobile App ────────────────────────────────────────────────────
  const mobId = SEED_PROJECTS[1].id;
  const mob = await getStatuses(mobId);
  if (mob.todo && mob.inProgress && mob.done) {
    const mobItems = [
      {
        id: MOB_STORY_1_ID,
        itemKey: 'MOB-1',
        type: 'story' as const,
        title: 'Implement biometric authentication (Face ID / Fingerprint)',
        statusId: mob.todo,
        scheduleState: 'defined' as const,
        priority: 'high' as const,
        storyPoints: 8,
        assigneeId: ADMIN_USER_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'MOB-2',
        type: 'story' as const,
        title: 'Dark mode support across all screens',
        statusId: mob.inProgress,
        scheduleState: 'in_progress' as const,
        priority: 'normal' as const,
        storyPoints: 5,
        assigneeId: DEVELOPER_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'MOB-3',
        type: 'defect' as const,
        title: 'App crashes on Android 14 when rotating to landscape on Home screen',
        statusId: mob.todo,
        scheduleState: 'defined' as const,
        priority: 'urgent' as const,
        assigneeId: DEVELOPER_ID,
      },
      // Task under MOB-1
      {
        id: uuidv7(),
        itemKey: 'MOB-4',
        type: 'task' as const,
        title: 'Integrate expo-local-authentication SDK',
        statusId: mob.todo,
        scheduleState: 'defined' as const,
        priority: 'high' as const,
        parentId: MOB_STORY_1_ID,
        estimateHours: '4',
        todoHours: '4',
      },
    ];

    for (const item of mobItems) {
      await db
        .insert(workItems)
        .values({
          ...item,
          tenantId: SYSTEM_TENANT_ID,
          projectId: mobId,
          createdBy: ADMIN_USER_ID,
          rank: item.itemKey,
        })
        .onConflictDoNothing();
    }
    await db
      .update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, ${mobItems.length})` })
      .where(eq(projectCounters.projectId, mobId));
  }

  console.log('✅  Work items seeded');
}

// ── Phase 2: Teams ───────────────────────────────────────────────────────────
async function seedTeams() {
  await db.insert(teams).values([
    {
      id: TEAM_ALPHA_ID,
      tenantId: SYSTEM_TENANT_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Team Alpha',
      key: 'ALPHA',
      description: 'Core platform team — owns NX Platform and DevOps projects.',
      leadId: ADMIN_USER_ID,
      status: 'active',
    },
    {
      id: TEAM_BETA_ID,
      tenantId: SYSTEM_TENANT_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Team Beta',
      key: 'BETA',
      description: 'Product team — owns Mobile App and Partner Portal.',
      leadId: DEVELOPER_ID,
      status: 'active',
    },
  ]).onConflictDoNothing();

  // Team members
  await db.insert(teamMembers).values([
    { id: '00000000-0000-7000-8000-000000000080', tenantId: SYSTEM_TENANT_ID, teamId: TEAM_ALPHA_ID, userId: ADMIN_USER_ID, status: 'active' },
    { id: '00000000-0000-7000-8000-000000000081', tenantId: SYSTEM_TENANT_ID, teamId: TEAM_ALPHA_ID, userId: DEVELOPER_ID, status: 'active' },
    { id: '00000000-0000-7000-8000-000000000082', tenantId: SYSTEM_TENANT_ID, teamId: TEAM_BETA_ID, userId: DEVELOPER_ID, status: 'active' },
    { id: '00000000-0000-7000-8000-000000000083', tenantId: SYSTEM_TENANT_ID, teamId: TEAM_BETA_ID, userId: VIEWER_ID, status: 'active' },
  ]).onConflictDoNothing();

  console.log('✅  Teams seeded');
}

// ── Phase 1+2: Releases ──────────────────────────────────────────────────────
async function seedReleases() {
  const nxpId = SEED_PROJECTS[0].id;
  const mobId = SEED_PROJECTS[1].id;

  await db.insert(releases).values([
    // NXP releases
    {
      id: NXP_RELEASE_1_ID,
      tenantId: SYSTEM_TENANT_ID,
      projectId: nxpId,
      name: 'v2.0 — NX Platform Upgrade',
      description: 'Major upgrade to NX v21 + ESLint flat-config rollout.',
      status: 'planned',
      targetDate: '2026-07-31',
    },
    {
      id: NXP_RELEASE_2_ID,
      tenantId: SYSTEM_TENANT_ID,
      projectId: nxpId,
      name: 'v2.1 — Storybook & DX',
      description: 'Storybook 8 integration and developer experience improvements.',
      status: 'planned',
      targetDate: '2026-08-31',
    },
    // MOB release
    {
      id: '00000000-0000-7000-8000-000000000052',
      tenantId: SYSTEM_TENANT_ID,
      projectId: mobId,
      name: 'v1.5 — Auth & Accessibility',
      description: 'Biometric auth, dark mode, and accessibility fixes.',
      status: 'planned',
      targetDate: '2026-08-15',
    },
  ]).onConflictDoNothing();

  console.log('✅  Releases seeded');
}

// ── Phase 2: Iterations ──────────────────────────────────────────────────────
async function seedIterations() {
  const nxpId = SEED_PROJECTS[0].id;
  const mobId = SEED_PROJECTS[1].id;

  await db.insert(iterations).values([
    // ── NXP iterations (3 sprints — past / current / next) ──────────────────
    {
      id: NXP_ITER_PREV_ID,
      tenantId: SYSTEM_TENANT_ID,
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
      tenantId: SYSTEM_TENANT_ID,
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
      tenantId: SYSTEM_TENANT_ID,
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
      tenantId: SYSTEM_TENANT_ID,
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
  ]).onConflictDoNothing();

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
      itemKey: 'NXP-7',
      type: 'story' as const,
      title: 'Migrate all apps to ESLint flat-config',
      statusId: nxpInProgress,
      scheduleState: 'in_progress' as const,
      priority: 'high' as const,
      storyPoints: 5,
      assigneeId: ADMIN_USER_ID,
      iterationId: NXP_ITER_CURRENT_ID,
      releaseId: NXP_RELEASE_1_ID,
    },
    {
      id: NXP_STORY_8_ID,
      itemKey: 'NXP-8',
      type: 'story' as const,
      title: 'Enforce strict TypeScript settings across workspace',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'normal' as const,
      storyPoints: 3,
      assigneeId: DEVELOPER_ID,
      iterationId: NXP_ITER_CURRENT_ID,
      releaseId: NXP_RELEASE_1_ID,
    },
    {
      id: NXP_STORY_9_ID,
      itemKey: 'NXP-9',
      type: 'story' as const,
      title: 'Add Storybook 8 to component library',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'normal' as const,
      storyPoints: 8,
      assigneeId: DEVELOPER_ID,
      iterationId: NXP_ITER_NEXT_ID,
      releaseId: NXP_RELEASE_2_ID,
    },
    // Accepted item (from previous sprint)
    {
      id: NXP_STORY_10_ID,
      itemKey: 'NXP-10',
      type: 'story' as const,
      title: 'Setup shared tsconfig base with path aliases',
      statusId: nxpDone,
      scheduleState: 'accepted' as const,
      priority: 'high' as const,
      storyPoints: 3,
      assigneeId: ADMIN_USER_ID,
      iterationId: NXP_ITER_PREV_ID,
      releaseId: NXP_RELEASE_1_ID,
    },
    // Defect in current sprint
    {
      id: NXP_DEFECT_11_ID,
      itemKey: 'NXP-11',
      type: 'defect' as const,
      title: 'ESLint rule conflicts between root and app-level configs',
      statusId: nxpInProgress,
      scheduleState: 'in_progress' as const,
      priority: 'urgent' as const,
      assigneeId: ADMIN_USER_ID,
      iterationId: NXP_ITER_CURRENT_ID,
    },
    // Backlog items (no iteration)
    {
      id: uuidv7(),
      itemKey: 'NXP-12',
      type: 'story' as const,
      title: 'Automate dependency graph visualisation in CI',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'low' as const,
      storyPoints: 5,
      assigneeId: DEVELOPER_ID,
    },
    {
      id: uuidv7(),
      itemKey: 'NXP-13',
      type: 'story' as const,
      title: 'Integrate Chromatic for visual regression testing',
      statusId: nxpTodo,
      scheduleState: 'defined' as const,
      priority: 'normal' as const,
      storyPoints: 5,
      releaseId: NXP_RELEASE_2_ID,
    },
  ];

  for (const item of nxpExtended) {
    await db.insert(workItems).values({
      ...item,
      tenantId: SYSTEM_TENANT_ID,
      projectId: nxpId,
      createdBy: ADMIN_USER_ID,
      rank: item.itemKey,
    }).onConflictDoNothing();
  }

  // Update counter — use GREATEST so re-running seed never regresses below existing keys
  await db.update(projectCounters)
    .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 13)` })
    .where(eq(projectCounters.projectId, nxpId));

  // MOB extended items (with iteration)
  if (mobTodo && mobInProgress) {
    const mobExtended = [
      {
        id: uuidv7(),
        itemKey: 'MOB-5',
        type: 'story' as const,
        title: 'Implement Face ID login flow (iOS)',
        statusId: mobInProgress,
        scheduleState: 'in_progress' as const,
        priority: 'high' as const,
        storyPoints: 5,
        assigneeId: DEVELOPER_ID,
        iterationId: MOB_ITER_CURRENT_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'MOB-6',
        type: 'story' as const,
        title: 'Dark mode — apply theme tokens to navigation screens',
        statusId: mobTodo,
        scheduleState: 'defined' as const,
        priority: 'normal' as const,
        storyPoints: 3,
        assigneeId: DEVELOPER_ID,
        iterationId: MOB_ITER_CURRENT_ID,
      },
      {
        id: uuidv7(),
        itemKey: 'MOB-7',
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
      await db.insert(workItems).values({
        ...item,
        tenantId: SYSTEM_TENANT_ID,
        projectId: mobId,
        createdBy: ADMIN_USER_ID,
        rank: item.itemKey,
      }).onConflictDoNothing();
    }

    await db.update(projectCounters)
      .set({ lastItemNumber: sql`GREATEST(${projectCounters.lastItemNumber}, 7)` })
      .where(eq(projectCounters.projectId, mobId));
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
  const T = SYSTEM_TENANT_ID;

  type ActivityRow = typeof schema.activityLogs.$inferInsert;

  const rows: ActivityRow[] = [
    // NXP-1
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_1_ID, entityType: 'work_item', entityId: NXP_STORY_1_ID, actorId: ADMIN_USER_ID, action: 'work_item.created', changes: null, metadata: { title: 'Upgrade NX to v21 and apply migrations', type: 'story' } },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_1_ID, entityType: 'work_item', entityId: NXP_STORY_1_ID, actorId: ADMIN_USER_ID, action: 'work_item.assigned', changes: { field: 'assigneeId', old: null, new: DEVELOPER_ID }, metadata: {} },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_1_ID, entityType: 'work_item', entityId: NXP_STORY_1_ID, actorId: DEVELOPER_ID, action: 'work_item.schedule_state_changed', changes: { field: 'scheduleState', old: 'defined', new: 'in_progress' }, metadata: {} },
    // NXP-2
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_2_ID, entityType: 'work_item', entityId: NXP_STORY_2_ID, actorId: ADMIN_USER_ID, action: 'work_item.created', changes: null, metadata: { title: 'Replace tslint with ESLint workspace-wide', type: 'story' } },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_2_ID, entityType: 'work_item', entityId: NXP_STORY_2_ID, actorId: ADMIN_USER_ID, action: 'work_item.priority_changed', changes: { field: 'priority', old: 'normal', new: 'high' }, metadata: {} },
    // MOB-1
    { id: uuidv7(), tenantId: T, projectId: MOB, workItemId: MOB_STORY_1_ID, entityType: 'work_item', entityId: MOB_STORY_1_ID, actorId: ADMIN_USER_ID, action: 'work_item.created', changes: null, metadata: { title: 'Scaffold React Native project with Expo 51', type: 'story' } },
    { id: uuidv7(), tenantId: T, projectId: MOB, workItemId: MOB_STORY_1_ID, entityType: 'work_item', entityId: MOB_STORY_1_ID, actorId: DEVELOPER_ID, action: 'work_item.assigned', changes: { field: 'assigneeId', old: null, new: DEVELOPER_ID }, metadata: {} },
    // NXP-7
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_7_ID, entityType: 'work_item', entityId: NXP_STORY_7_ID, actorId: ADMIN_USER_ID, action: 'work_item.created', changes: null, metadata: { title: 'Migrate all apps to ESLint flat-config', type: 'story' } },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_7_ID, entityType: 'work_item', entityId: NXP_STORY_7_ID, actorId: ADMIN_USER_ID, action: 'work_item.assigned', changes: { field: 'assigneeId', old: null, new: ADMIN_USER_ID }, metadata: {} },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_7_ID, entityType: 'work_item', entityId: NXP_STORY_7_ID, actorId: ADMIN_USER_ID, action: 'work_item.flow_state_changed', changes: { field: 'statusId', old: null, new: 'in_progress' }, metadata: { statusName: 'In Progress' } },
    // NXP-8
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_8_ID, entityType: 'work_item', entityId: NXP_STORY_8_ID, actorId: ADMIN_USER_ID, action: 'work_item.created', changes: null, metadata: { title: 'Enforce strict TypeScript settings across workspace', type: 'story' } },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_8_ID, entityType: 'work_item', entityId: NXP_STORY_8_ID, actorId: ADMIN_USER_ID, action: 'work_item.assigned', changes: { field: 'assigneeId', old: null, new: DEVELOPER_ID }, metadata: {} },
    // NXP-10 (accepted — show full lifecycle)
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_10_ID, entityType: 'work_item', entityId: NXP_STORY_10_ID, actorId: ADMIN_USER_ID, action: 'work_item.created', changes: null, metadata: { title: 'Setup shared tsconfig base with path aliases', type: 'story' } },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_10_ID, entityType: 'work_item', entityId: NXP_STORY_10_ID, actorId: ADMIN_USER_ID, action: 'work_item.assigned', changes: { field: 'assigneeId', old: null, new: ADMIN_USER_ID }, metadata: {} },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_10_ID, entityType: 'work_item', entityId: NXP_STORY_10_ID, actorId: ADMIN_USER_ID, action: 'work_item.schedule_state_changed', changes: { field: 'scheduleState', old: 'defined', new: 'in_progress' }, metadata: {} },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_STORY_10_ID, entityType: 'work_item', entityId: NXP_STORY_10_ID, actorId: ADMIN_USER_ID, action: 'work_item.schedule_state_changed', changes: { field: 'scheduleState', old: 'in_progress', new: 'accepted' }, metadata: {} },
    // NXP-11 (urgent defect)
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_DEFECT_11_ID, entityType: 'work_item', entityId: NXP_DEFECT_11_ID, actorId: DEVELOPER_ID, action: 'work_item.created', changes: null, metadata: { title: 'ESLint rule conflicts between root and app-level configs', type: 'defect' } },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_DEFECT_11_ID, entityType: 'work_item', entityId: NXP_DEFECT_11_ID, actorId: ADMIN_USER_ID, action: 'work_item.priority_changed', changes: { field: 'priority', old: 'normal', new: 'urgent' }, metadata: {} },
    { id: uuidv7(), tenantId: T, projectId: NXP, workItemId: NXP_DEFECT_11_ID, entityType: 'work_item', entityId: NXP_DEFECT_11_ID, actorId: ADMIN_USER_ID, action: 'work_item.assigned', changes: { field: 'assigneeId', old: null, new: ADMIN_USER_ID }, metadata: {} },
  ];

  await db.insert(schema.activityLogs).values(rows);
  console.log(`✅  Activity logs seeded (${rows.length} entries)`);
}

/**
 * Run all seed operations against the given database URL.
 * Exported so db/migrate.ts can call it when SEED_ON_DEPLOY=true.
 * Safe to call multiple times — all inserts use onConflictDoNothing.
 */
export async function seed(connectionUrl?: string): Promise<void> {
  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  db = drizzle(pool, { schema });

  try {
    console.log('Seeding...');

    // ── Tenant ──────────────────────────────────────────────────────────────
    await db
      .insert(schema.tenants)
      .values({
        id: SYSTEM_TENANT_ID,
        slug: 'acme',
        name: 'Acme Corp (Dev Tenant)',
        status: 'active',
        plan: 'free',
      })
      .onConflictDoNothing();

    // ── Workspace ────────────────────────────────────────────────────────────
    await db
      .insert(schema.workspaces)
      .values({
        id: WORKSPACE_ID,
        tenantId: SYSTEM_TENANT_ID,
        slug: 'main',
        name: 'ACME Corp',
      })
      .onConflictDoNothing();

    // ── Admin user ───────────────────────────────────────────────────────────
    // Break-glass credentials are injected via env — never hardcoded in git.
    const breakglassEmail = process.env['BREAKGLASS_EMAIL'] ?? 'admin@acme.dev';
    const breakglassPassword = process.env['BREAKGLASS_PASSWORD'] ?? 'Admin@Rally2026!';
    const passwordHash = await argon2.hash(breakglassPassword, { type: argon2.argon2id });
    await db
      .insert(schema.users)
      .values({
        id: ADMIN_USER_ID,
        email: breakglassEmail,
        displayName: 'Admin User',
        emailVerified: true,
        locale: 'en',
        timezone: 'Asia/Ho_Chi_Minh',
        passwordHash,
      })
      .onConflictDoNothing();

    // ── Tenant member (global user → tenant link) ────────────────────────────
    await db
      .insert(schema.tenantMembers)
      .values({ tenantId: SYSTEM_TENANT_ID, userId: ADMIN_USER_ID })
      .onConflictDoNothing();

    // ── Workspace member ─────────────────────────────────────────────────────
    await db
      .insert(schema.workspaceMembers)
      .values({
        tenantId: SYSTEM_TENANT_ID,
        workspaceId: WORKSPACE_ID,
        userId: ADMIN_USER_ID,
      })
      .onConflictDoNothing();

    // ── Additional users: developer + viewer ─────────────────────────────────
    const devHash = await argon2.hash('Dev@Rally2026!', { type: argon2.argon2id });
    const viewerHash = await argon2.hash('Viewer@Rally2026!', { type: argon2.argon2id });
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
          passwordHash: devHash,
        },
        {
          id: VIEWER_ID,
          email: 'viewer@acme.dev',
          displayName: 'Bob Viewer',
          emailVerified: true,
          locale: 'en',
          timezone: 'Asia/Ho_Chi_Minh',
          passwordHash: viewerHash,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(schema.tenantMembers)
      .values([
        { tenantId: SYSTEM_TENANT_ID, userId: DEVELOPER_ID },
        { tenantId: SYSTEM_TENANT_ID, userId: VIEWER_ID },
      ])
      .onConflictDoNothing();

    await db
      .insert(schema.workspaceMembers)
      .values([
        { tenantId: SYSTEM_TENANT_ID, workspaceId: WORKSPACE_ID, userId: DEVELOPER_ID },
        { tenantId: SYSTEM_TENANT_ID, workspaceId: WORKSPACE_ID, userId: VIEWER_ID },
      ])
      .onConflictDoNothing();

    // ── System roles ─────────────────────────────────────────────────────────
    const ROLES = [
      {
        slug: 'workspace_admin',
        name: 'Workspace Admin',
        permissions: [
          'workspace:*',
          'project:view',
          'project:create',
          'project:edit',
          'project:archive',
          'project:restore',
          'project:delete',
          'work_item:create',
          'work_item:edit',
          'work_item:delete',
          'work_item:view',
          'iteration:view',
          'iteration:manage',
          'release:manage',
        ],
      },
      {
        slug: 'project_admin',
        name: 'Project Admin',
        permissions: [
          'project:view',
          'project:create',
          'project:edit',
          'project:archive',
          'project:restore',
          'work_item:create',
          'work_item:edit',
          'work_item:delete',
          'work_item:view',
          'iteration:view',
          'iteration:manage',
          'release:manage',
        ],
      },
      {
        slug: 'project_member',
        name: 'Project Member',
        // BA spec: Developer can update any work item (no "own-only" concept)
        permissions: ['work_item:create', 'work_item:edit', 'work_item:view', 'iteration:view'],
      },
      {
        slug: 'project_viewer',
        name: 'Project Viewer',
        permissions: ['work_item:view', 'iteration:view'],
      },
      {
        slug: 'workspace_member',
        name: 'Workspace Member',
        permissions: ['workspace:view', 'project:view'],
      },
      { slug: 'guest', name: 'Guest', permissions: ['work_item:view:public'] },
    ];

    for (const role of ROLES) {
      await db
        .insert(schema.systemRoles)
        .values({
          name: role.name,
          slug: role.slug,
          isSystem: true,
          permissions: role.permissions,
        })
        .onConflictDoUpdate({
          target: schema.systemRoles.slug,
          set: { permissions: role.permissions, name: role.name },
        });
    }

    // ── Admin user role assignment (workspace_admin for the default workspace) ──
    const adminRoleRow = await db
      .select({ id: schema.systemRoles.id })
      .from(schema.systemRoles)
      .where(eq(schema.systemRoles.slug, 'workspace_admin'))
      .limit(1);

    if (adminRoleRow[0]) {
      await db
        .insert(userRoleAssignments)
        .values({
          tenantId: SYSTEM_TENANT_ID,
          userId: ADMIN_USER_ID,
          roleId: adminRoleRow[0].id,
          scopeType: 'workspace',
          scopeId: WORKSPACE_ID,
          grantedBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }

    // ── Developer role assignment (project_member) ────────────────────────────
    const [memberRoleRow] = await db
      .select({ id: schema.systemRoles.id })
      .from(schema.systemRoles)
      .where(eq(schema.systemRoles.slug, 'project_member'))
      .limit(1);

    if (memberRoleRow) {
      await db
        .insert(userRoleAssignments)
        .values({
          tenantId: SYSTEM_TENANT_ID,
          userId: DEVELOPER_ID,
          roleId: memberRoleRow.id,
          scopeType: 'workspace',
          scopeId: WORKSPACE_ID,
          grantedBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }

    // ── Viewer role assignment (project_viewer) ───────────────────────────────
    const [viewerRoleRow] = await db
      .select({ id: schema.systemRoles.id })
      .from(schema.systemRoles)
      .where(eq(schema.systemRoles.slug, 'project_viewer'))
      .limit(1);

    if (viewerRoleRow) {
      await db
        .insert(userRoleAssignments)
        .values({
          tenantId: SYSTEM_TENANT_ID,
          userId: VIEWER_ID,
          roleId: viewerRoleRow.id,
          scopeType: 'workspace',
          scopeId: WORKSPACE_ID,
          grantedBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }

    // ── Subscription ─────────────────────────────────────────────────────────
    await db
      .insert(schema.subscriptions)
      .values({
        tenantId: SYSTEM_TENANT_ID,
        plan: 'free',
        status: 'active',
      })
      .onConflictDoNothing();

    // ── Projects (real business flow: project + counter + member + statuses) ──
    for (const project of SEED_PROJECTS) {
      await seedProject(project);
    }

    // ── Add developer as NXP project member (so seeded assigneeId is valid) ──
    await db
      .insert(projectMembers)
      .values({
        id: uuidv7(),
        tenantId: SYSTEM_TENANT_ID,
        projectId: SEED_PROJECTS[0].id, // NXP
        userId: DEVELOPER_ID,
        status: 'active',
      })
      .onConflictDoNothing();

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

    // ── SSO connection (dev) ──────────────────────────────────────────────────
    // Maps the configured Entra directory (`ENTRA_TENANT_ID`) to the acme tenant
    // so federated login resolves through the proper per-tenant SSO registry
    // instead of the dev-only ENTRA_DEFAULT_TENANT_ID fallback.
    const entraTid = process.env['ENTRA_TENANT_ID'];
    if (entraTid) {
      await db
        .insert(ssoConnections)
        .values({
          tenantId: SYSTEM_TENANT_ID,
          workspaceId: WORKSPACE_ID,
          provider: 'entra',
          externalTenantId: entraTid,
          defaultRoleSlug: 'project_member',
          allowedEmailDomains: [],
          jitEnabled: true,
          status: 'active',
        })
        .onConflictDoNothing();
      console.log(`   ↳ SSO connection seeded for Entra tid ${entraTid} → acme tenant`);
    }

    console.log(`✅  Seed complete — ${SEED_PROJECTS.length} projects, 3 users, 2 teams, 4 iterations, 3 releases, work items seeded`);
  } finally {
    await pool.end();
  }
}

// Run directly: pnpm db:seed
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
