/**
 * workspace schema — workspaces, workspace_members, workspace_invitations,
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
  integer,
  smallint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaceStatusEnum, workspaceMemberStatusEnum, invitationStatusEnum } from './enums';
import type { PreliminaryEstimateMap } from './enums';

export const workspaceSchema = pgSchema('workspace');

// ── workspaces (root) ───────────────────────────────────────────────────────

export const workspaces = workspaceSchema.table(
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

export const workspaceMembers = workspaceSchema.table(
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

export const workspaceInvitations = workspaceSchema.table(
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
    // Resend tracking: how many times the invite was re-sent (0 on create) and
    // when the last email went out (drives the per-invite resend cooldown).
    resendCount: integer('resend_count').notNull().default(0),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
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

export const workspaceSettings = workspaceSchema.table(
  'workspace_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    defaultLocale: varchar('default_locale', { length: 10 }).notNull().default('en'),
    dateFormat: varchar('date_format', { length: 20 }),
    // Preliminary Estimate size → { points, count } (P5.1/P5.2).
    //
    // Configuration, not a constant, from day one. The BA spec calls the seeded
    // XS=1/S=3/M=5/L=8/XL=13 values "temporary mockup data" and defers the real scale
    // to `Settings > Workspace > Project Management`; Rally makes the same mapping a
    // workspace-admin setting. Shipping it as a service constant would make that later
    // slice a data migration plus a silent change to every existing estimate.
    //
    // Shape: `PreliminaryEstimateMap` in db/schema/enums.ts. Seeded from
    // DEFAULT_PRELIMINARY_ESTIMATE_MAP; the Settings UI arrives later and edits this.
    // `$type` so every reader gets the shape rather than `unknown`. `{}` is the default and
    // means "fall back to the seeded map" — see `PreliminaryEstimateMapService`.
    preliminaryEstimateMap: jsonb('preliminary_estimate_map')
      .$type<Partial<PreliminaryEstimateMap>>()
      .notNull()
      .default({}),
    // The working-day calendar the Iteration Burndown renders and indexes its Ideal
    // line by (IB §2, IB-BR-03). ISO numbering, 1 = Monday … 7 = Sunday, matching
    // Postgres `EXTRACT(ISODOW FROM date)` so the report query filters without
    // translating. Mon–Fri by default — confirmed against the approved mockup, whose
    // burndown axis omits weekends.
    //
    // Configuration rather than a service constant for the same reason as the
    // preliminary-estimate map: a Sun–Thu working week must not be a code change, and
    // the day a holiday calendar arrives there must be exactly one place that decides
    // what a working day is. Holidays are deliberately not modelled here — separate
    // data with its own lifecycle, and out of scope for this phase.
    workingDays: smallint('working_days').array().notNull().default([1, 2, 3, 4, 5]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: uniqueIndex('uq_workspace_settings').on(t.workspaceId),
  }),
);
