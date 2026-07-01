/**
 * identity schema — users, auth_sessions
 * Canonical DDL: 05_Architecture/DATABASE_SCHEMA.md §9
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { userStatusEnum, ssoProviderEnum, ssoConnectionStatusEnum } from './enums';

export const identitySchema = pgSchema('identity');

// ── users ─────────────────────────────────────────────────────────────────

export const users = identitySchema.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 2048 }),
    passwordHash: text('password_hash'),
    status: userStatusEnum('status').notNull().default('active'),
    emailVerified: boolean('email_verified').notNull().default(false),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    locale: varchar('locale', { length: 10 }).notNull().default('en'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    sessionVersion: integer('session_version').notNull().default(1),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    emailIdx: uniqueIndex('uq_users_email')
      .on(t.email)
      .where(sql`deleted_at IS NULL`),
  }),
);

// ── auth_sessions ─────────────────────────────────────────────────────────

export const authSessions = identitySchema.table(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    deviceInfo: jsonb('device_info'),
    ipAddress: varchar('ip_address', { length: 45 }),
    isRevoked: boolean('is_revoked').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set for SSO sessions — used to re-derive authMethod on token refresh. */
    ssoProvider: varchar('sso_provider', { length: 32 }),
  },
  (t) => ({
    tenantIdx: index('ix_auth_sessions_tenant').on(t.tenantId),
    tokenHashIdx: uniqueIndex('uq_auth_sessions_token_hash').on(t.tokenHash),
    userIdx: index('ix_auth_sessions_user').on(t.userId),
    familyIdx: index('ix_auth_sessions_family').on(t.familyId),
    // Partial index — most lookups only need active sessions; halves index size
    activeUserIdx: index('ix_auth_sessions_active_user')
      .on(t.userId)
      .where(sql`is_revoked = false`),
  }),
);

import { sql } from 'drizzle-orm';

// ── sso_identities ───────────────────────────────────────────────────────────
// Links an external SSO identity (e.g. Microsoft Entra) to a Rally user.
// One user may have at most one identity per provider.

export const ssoIdentities = identitySchema.table(
  'sso_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** Provider identifier — currently only 'entra' (Microsoft Entra ID). */
    provider: varchar('provider', { length: 32 }).notNull(),
    /** Stable subject ID from the provider (Entra: `oid` claim). */
    providerSub: varchar('provider_sub', { length: 255 }).notNull(),
    /** Email address from the provider token at the time of linking. */
    providerEmail: varchar('provider_email', { length: 320 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // A single Entra OID maps to exactly one Rally user globally
    providerSubIdx: uniqueIndex('uq_sso_identities_provider_sub').on(t.provider, t.providerSub),
    userIdx: index('ix_sso_identities_user').on(t.userId),
  }),
);

// ── sso_connections ──────────────────────────────────────────────────────────
// Maps an external identity provider (identified by its directory/tenant id or
// issuer) to a single Rally tenant. This is the authoritative, enterprise-grade
// mechanism for resolving which tenant a federated user belongs to — the same
// model used by Okta/WorkOS/Rally: the IdP is the unit of trust, not the email.
//
// During SSO login the Entra `tid` claim is matched against `external_tenant_id`
// to deterministically route the user into the correct tenant. Domain allow-list
// and a JIT toggle give tenant admins control over auto-provisioning.

export const ssoConnections = identitySchema.table(
  'sso_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Rally tenant this IdP connection provisions users into. */
    tenantId: uuid('tenant_id').notNull(),
    /** Default workspace JIT-provisioned users join. */
    workspaceId: uuid('workspace_id').notNull(),
    /** Federation protocol/provider. */
    provider: ssoProviderEnum('provider').notNull().default('entra'),
    /** IdP directory id — Entra `tid` claim (the primary match key). */
    externalTenantId: varchar('external_tenant_id', { length: 255 }).notNull(),
    /** Full token issuer URL — optional secondary match key (SAML/OIDC). */
    issuer: varchar('issuer', { length: 512 }),
    /** System-role slug assigned to JIT-provisioned users (e.g. 'project_member'). */
    defaultRoleSlug: varchar('default_role_slug', { length: 64 })
      .notNull()
      .default('project_member'),
    /** Email domains permitted to provision via this connection. Empty = any. */
    allowedEmailDomains: jsonb('allowed_email_domains').$type<string[]>().notNull().default([]),
    /** When false, new users are NOT auto-created — they must be invited first. */
    jitEnabled: boolean('jit_enabled').notNull().default(true),
    status: ssoConnectionStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One IdP directory maps to exactly one Rally tenant per provider.
    providerExternalIdx: uniqueIndex('uq_sso_connections_provider_external').on(
      t.provider,
      t.externalTenantId,
    ),
    tenantIdx: index('ix_sso_connections_tenant').on(t.tenantId),
  }),
);

// ── password_reset_tokens ────────────────────────────────────────────────

export const passwordResetTokens = identitySchema.table(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('uq_prt_token_hash').on(t.tokenHash),
    userIdx: index('ix_prt_user').on(t.userId),
  }),
);
