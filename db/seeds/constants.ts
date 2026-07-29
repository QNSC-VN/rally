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

// ── Single end-to-end demo flow (NXP only) ───────────────────────────────────
// Team Alpha (with members) → Story + Defect (team-linked) → 2 Tasks under the
// Story (team/iteration inherited) → Iteration (contains Story + Defect) →
// Release + Milestone (linked to each other and to the Story). Every FK below
// resolves to a real, matching row — see demo.ts `seedFlow()`.
export const NXP_STORY_1_ID = '00000000-0000-7000-8000-000000000030';
export const NXP_DEFECT_1_ID = '00000000-0000-7000-8000-000000000031';
export const NXP_TASK_1_ID = '00000000-0000-7000-8000-000000000032';
export const NXP_TASK_2_ID = '00000000-0000-7000-8000-000000000033';

export const TEAM_ALPHA_ID = '00000000-0000-7000-8000-000000000040';

export const NXP_RELEASE_1_ID = '00000000-0000-7000-8000-000000000050';

export const NXP_ITER_CURRENT_ID = '00000000-0000-7000-8000-000000000061'; // committed ← active

export const NXP_MILESTONE_1_ID = '00000000-0000-7000-8000-0000000000b0';

// Portfolio fixture (P5): Epic → two Features, with the first Feature linked to
// the Story + Defect above so its rollup is non-empty and the second left empty so
// the "unmeasurable" rendering (em-dash, not 0%) has a case. Seeded because the
// Portfolio screen has no write paths yet, so E2E cannot create its own fixture.
export const NXP_EPIC_1_ID = '00000000-0000-7000-8000-0000000000c0';
export const NXP_FEATURE_1_ID = '00000000-0000-7000-8000-0000000000c1';
export const NXP_FEATURE_2_ID = '00000000-0000-7000-8000-0000000000c2';

// ── Seed data constants ───────────────────────────────────────────────────────
// Format: { id, key, name, description }
// All are owned by ADMIN_USER_ID and belong to the default workspace.
//
// NXP carries the full one-flow fixture (Team/Story/Defect/Tasks/Iteration/
// Release/Milestone) — the single project used by dev fixtures + E2E.
export const SEED_PROJECTS = [
  {
    id: '00000000-0000-7000-8000-000000000010',
    key: 'NXP',
    name: 'NX Platform',
    description: 'Core NX mono-repo platform upgrades and tooling improvements.',
  },
] as const;
