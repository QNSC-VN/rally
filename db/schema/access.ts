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
    isSystem: boolean('is_system').notNull().default(false),
    permissions: jsonb('permissions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('uq_system_roles_slug').on(t.slug),
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
