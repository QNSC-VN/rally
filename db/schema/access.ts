/**
 * access schema — system_roles, permissions, user_role_assignments
 * Canonical DDL: 05_Architecture/DATABASE_SCHEMA.md §9
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  unique,
} from 'drizzle-orm/pg-core';
import { scopeTypeEnum } from './enums';

export const accessSchema = pgSchema('access');

export const systemRoles = accessSchema.table(
  'system_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id'), // NULL = global system role
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    /**
     * VESTIGIAL — do not branch on this, and do not use it to mean "custom role".
     *
     * `db/seeds/bootstrap.ts` writes `false` for the workspace-owned EDITABLE COPIES of the tier
     * roles, so on any seeded database `project_admin` and `project_member` carry `false` right beside
     * a genuine custom role. A report keyed on this flag listed the two roles the whole access model
     * depends on as deletable (caught before it reached a migration); the discriminator is the SLUG —
     * anything outside `SYSTEM_ROLE` in `db/permissions.catalog.ts`.
     *
     * Nothing reads it any more: it is off the domain type, the response DTO and the SPA. The column
     * survives only because dropping it needs a migration, and that belongs with the one that removes
     * the leftover custom-role ROWS (`pnpm db:report:custom-roles` gates it).
     */
    isSystem: boolean('is_system').notNull().default(false),
    permissions: jsonb('permissions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Uniqueness is per-workspace so each workspace can own an editable copy of
    // a tier role alongside the global template (workspace_id IS NULL). NULLS
    // NOT DISTINCT keeps the global rows themselves deduplicated by slug.
    workspaceSlugUq: unique('uq_system_roles_workspace_slug')
      .on(t.workspaceId, t.slug)
      .nullsNotDistinct(),
    workspaceIdx: index('ix_system_roles_workspace').on(t.workspaceId),
  }),
);

export const userRoleAssignments = accessSchema.table(
  'user_role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    scopeType: scopeTypeEnum('scope_type').notNull(),
    scopeId: uuid('scope_id'), // NULL for global scope
    grantedBy: uuid('granted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_ura_workspace').on(t.workspaceId),
    userIdx: index('ix_ura_user').on(t.userId),
    uniqueAssignment: uniqueIndex('uq_ura_user_role_scope').on(
      t.userId,
      t.roleId,
      t.scopeType,
      t.scopeId,
    ),
  }),
);
