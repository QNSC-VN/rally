/**
 * tenancy schema — workspaces, workspace_members, workspace_invitations,
 *                   workspace_settings
 *
 * `workspace` is the switchable root of the model (multi-tenancy was removed —
 * see docs/superpowers/specs/2026-07-09-drop-multi-tenant-merge-into-workspace-design.md).
 * Users are global (identity.users) and attached to one or many workspaces via
 * workspace_members.
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaceStatusEnum, workspaceMemberStatusEnum, invitationStatusEnum } from './enums';

export const tenancySchema = pgSchema('tenancy');

// ── workspaces (root) ───────────────────────────────────────────────────────

export const workspaces = tenancySchema.table(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 63 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    avatarUrl: varchar('avatar_url', { length: 2048 }),
    status: workspaceStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    slugIdx: uniqueIndex('uq_workspaces_slug')
      .on(t.slug)
      .where(sql`deleted_at IS NULL`),
    statusIdx: index('ix_workspaces_status').on(t.status),
  }),
);

// ── workspace_members ────────────────────────────────────────────────────────
// A global user's membership in a workspace (the isolation/switch boundary).
// Many-to-many: a person exists once in identity.users and is attached to one
// or many workspaces via these rows.

export const workspaceMembers = tenancySchema.table(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id'),
    status: workspaceMemberStatusEnum('status').notNull().default('active'),
    /** Drives "drop into your last-active workspace" at login when a user has many. */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueMember: uniqueIndex('uq_workspace_member').on(t.workspaceId, t.userId),
    userIdx: index('ix_wm_user').on(t.userId),
    statusIdx: index('ix_wm_status').on(t.workspaceId, t.status),
  }),
);

// ── workspace_invitations ────────────────────────────────────────────

export const workspaceInvitations = tenancySchema.table(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    roleId: uuid('role_id'),
    tokenHash: text('token_hash').notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    invitedBy: uuid('invited_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedBy: uuid('accepted_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_wi_workspace').on(t.workspaceId),
    tokenHashIdx: uniqueIndex('uq_wi_token_hash').on(t.tokenHash),
    emailIdx: index('ix_wi_email').on(t.workspaceId, t.email),
  }),
);

// ── workspace_settings ───────────────────────────────────────────────

export const workspaceSettings = tenancySchema.table(
  'workspace_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    defaultLocale: varchar('default_locale', { length: 10 }).notNull().default('en'),
    dateFormat: varchar('date_format', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: uniqueIndex('uq_workspace_settings').on(t.workspaceId),
  }),
);
