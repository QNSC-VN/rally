/**
 * tenancy schema — tenants, workspaces, workspace_members, subscriptions, project_counters
 * Canonical DDL: 05_Architecture/DATABASE_SCHEMA.md §9
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  tenantStatusEnum,
  subscriptionPlanEnum,
  subscriptionStatusEnum,
  workspaceMemberStatusEnum,
  invitationStatusEnum,
} from './enums';

export const tenancySchema = pgSchema('tenancy');

// ── tenants ───────────────────────────────────────────────────────────────

export const tenants = tenancySchema.table(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 63 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: tenantStatusEnum('status').notNull().default('active'),
    plan: subscriptionPlanEnum('plan').notNull().default('free'),
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    slugIdx: uniqueIndex('uq_tenants_slug')
      .on(t.slug)
      .where(sql`deleted_at IS NULL`),
    statusIdx: index('ix_tenants_status').on(t.status),
  }),
);

// ── workspaces ────────────────────────────────────────────────────────────

export const workspaces = tenancySchema.table(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    slug: varchar('slug', { length: 63 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    avatarUrl: varchar('avatar_url', { length: 2048 }),
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('ix_workspaces_tenant').on(t.tenantId),
    slugIdx: uniqueIndex('uq_workspaces_tenant_slug')
      .on(t.tenantId, t.slug)
      .where(sql`deleted_at IS NULL`),
  }),
);

// ── workspace_members ────────────────────────────────────────────────────

export const workspaceMembers = tenancySchema.table(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id'),
    status: workspaceMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_wm_tenant').on(t.tenantId),
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
    tenantId: uuid('tenant_id').notNull(),
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
    tenantIdx: index('ix_wi_tenant').on(t.tenantId),
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
    tenantId: uuid('tenant_id').notNull(),
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

// ── subscriptions ─────────────────────────────────────────────────────────

export const subscriptions = tenancySchema.table(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    plan: subscriptionPlanEnum('plan').notNull().default('free'),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    seatLimit: integer('seat_limit'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: uniqueIndex('uq_subscriptions_tenant').on(t.tenantId),
  }),
);

// ── tenant_domains ──────────────────────────────────────────────────────────
// Email-domain claims that bind a company's domain to a tenant. This is the
// enterprise "domain capture" mechanism that prevents tenant sprawl: once a
// domain is verified AND auto-join is enabled, new signups with that email
// domain join the existing tenant instead of creating a fragmented new one.
//
// A claim is created (unverified, auto-join off) the first time a tenant is
// provisioned from a corporate email. An admin later verifies ownership and
// opts in to auto-join.

export const tenantDomains = tenancySchema.table(
  'tenant_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    /** Lower-cased email domain, e.g. "bigcorp.com". Globally unique. */
    domain: varchar('domain', { length: 255 }).notNull(),
    /** True once the tenant proves it owns the domain (DNS/TXT, etc.). */
    verified: timestamp('verified_at', { withTimezone: true }),
    /** When true (and verified), new signups on this domain auto-join the tenant. */
    allowAutoJoin: boolean('allow_auto_join').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    domainIdx: uniqueIndex('uq_tenant_domains_domain').on(t.domain),
    tenantIdx: index('ix_tenant_domains_tenant').on(t.tenantId),
  }),
);

// ── tenant_members ────────────────────────────────────────────────────────────
// The "keycard": a global user's membership in a tenant (the subscription /
// billing boundary). This is the real-Rally identity model — a person exists
// once in identity.users (global) and is ATTACHED to one or many tenants via
// these rows, each carrying a status (and optional role). It replaces the old
// users.tenant_id 1:1 ownership so a single email can belong to multiple
// companies and switch between them at login.

export const tenantMembers = tenancySchema.table(
  'tenant_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** Optional tenant-level role; authoritative permissions live in access.* */
    roleId: uuid('role_id'),
    status: workspaceMemberStatusEnum('status').notNull().default('active'),
    /** Drives "drop into your last-active tenant" at login when a user has many. */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueMember: uniqueIndex('uq_tenant_member').on(t.tenantId, t.userId),
    tenantIdx: index('ix_tenant_members_tenant').on(t.tenantId),
    userIdx: index('ix_tenant_members_user').on(t.userId),
  }),
);

import { sql } from 'drizzle-orm';
