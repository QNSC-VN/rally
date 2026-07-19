import type { drizzle } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema';

/**
 * Shared seed constants — fixed UUIDs, project fixtures, and helpers used across
 * the tiered seed modules (reference / bootstrap / demo).
 *
 * NOTE: this module must stay self-contained within `db/` — the migrator Docker
 * image compiles `db/**` only and does NOT include `libs/`, so nothing here may
 * import from `libs/` (see DEFAULT_WORKFLOW_STATUSES, inlined for that reason).
 */

/** Drizzle handle typed against the full seed schema. */
export type Db = ReturnType<typeof drizzle<typeof schema>>;

// Inlined from libs/modules/projects/src/domain/project.constants.ts
// so the migrator Docker image (which doesn't include libs/) can run this seed.
export const DEFAULT_WORKFLOW_STATUSES = [
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

export function getDeterministicRank(itemKey: string): string {
  const match = itemKey.match(/\d+/);
  if (!match) return 'a0000';
  return 'a' + match[0].padStart(4, '0');
}

// Fixed UUIDs ensure idempotency — same rows on every seed run.
export const ADMIN_USER_ID = '00000000-0000-7000-8000-000000000002';
export const WORKSPACE_ID = '00000000-0000-7000-8000-000000000003';
export const DEVELOPER_ID = '00000000-0000-7000-8000-000000000020';
export const VIEWER_ID = '00000000-0000-7000-8000-000000000021';

// RBAC/PBAC demo users — one per otherwise-uncovered system role, plus a
// project-scoped "lead" that proves per-project (PBAC) differentiation.
export const PROJECT_ADMIN_ID = '00000000-0000-7000-8000-000000000022';
export const WORKSPACE_MEMBER_ID = '00000000-0000-7000-8000-000000000023';
export const PROJECT_LEAD_ID = '00000000-0000-7000-8000-000000000025';

export const NXP_STORY_1_ID = '00000000-0000-7000-8000-000000000030';
export const NXP_STORY_2_ID = '00000000-0000-7000-8000-000000000031';
export const MOB_STORY_1_ID = '00000000-0000-7000-8000-000000000032';

// ── Phase 2 fixed IDs ────────────────────────────────────────────────────────
export const TEAM_ALPHA_ID = '00000000-0000-7000-8000-000000000040';
export const TEAM_BETA_ID = '00000000-0000-7000-8000-000000000041';

// NXP releases
export const NXP_RELEASE_1_ID = '00000000-0000-7000-8000-000000000050';
export const NXP_RELEASE_2_ID = '00000000-0000-7000-8000-000000000051';

// NXP iterations (Sprint 26.1 = committed, Sprint 26.2 = planning, Sprint 25.4 = accepted)
export const NXP_ITER_PREV_ID = '00000000-0000-7000-8000-000000000060'; // accepted
export const NXP_ITER_CURRENT_ID = '00000000-0000-7000-8000-000000000061'; // committed ← active
export const NXP_ITER_NEXT_ID = '00000000-0000-7000-8000-000000000062'; // planning

// MOB iterations
export const MOB_ITER_CURRENT_ID = '00000000-0000-7000-8000-000000000063'; // committed

// Additional NXP work items with richer data
export const NXP_STORY_7_ID = '00000000-0000-7000-8000-000000000070';
export const NXP_STORY_8_ID = '00000000-0000-7000-8000-000000000071';
export const NXP_STORY_9_ID = '00000000-0000-7000-8000-000000000072';
export const NXP_STORY_10_ID = '00000000-0000-7000-8000-000000000073';
export const NXP_DEFECT_11_ID = '00000000-0000-7000-8000-000000000074';

// Feature parent + child defects that demo the Feature / Defects / Defect Status columns.
export const NXP_FEATURE_ID = '00000000-0000-7000-8000-000000000075';
export const NXP_CHILD_DEFECT_1_ID = '00000000-0000-7000-8000-000000000076'; // child of US-5 (closed)
export const NXP_CHILD_DEFECT_2_ID = '00000000-0000-7000-8000-000000000077'; // child of US-6 (open)
export const NXP_CHILD_DEFECT_3_ID = '00000000-0000-7000-8000-000000000078'; // child of US-6 (closed)

// ── Seed data constants ───────────────────────────────────────────────────────
// Format: { id, key, name, description }
// All are owned by ADMIN_USER_ID and belong to the default workspace.
export const SEED_PROJECTS = [
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
