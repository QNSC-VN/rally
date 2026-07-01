/**
 * Lightweight domain types for the identity bounded context.
 * Mirror the DB schema shape — no ORM dependency in the domain.
 */
import type { UserStatus } from '../../../../../db/schema/enums';
export type { UserStatus };

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  passwordHash: string | null;
  status: UserStatus;
  emailVerified: boolean;
  locale: string;
  timezone: string;
  sessionVersion: number;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSession {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  isRevoked: boolean;
  expiresAt: Date;
  createdAt: Date;
  /** SSO provider if session was created via SSO; null for password sessions. */
  ssoProvider: string | null;
}

export interface CreateSessionInput {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  ipAddress?: string;
  expiresAt: Date;
  /** Set to 'entra' for SSO sessions; omit for password sessions. */
  ssoProvider?: string;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface SsoIdentity {
  id: string;
  tenantId: string;
  userId: string;
  provider: string;
  providerSub: string;
  providerEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps an external identity provider (Entra `tid`, SAML/OIDC issuer) to a single
 * Rally tenant. Resolved during SSO login to route a federated user into the
 * correct tenant without relying on an insecure global default.
 */
export interface SsoConnection {
  id: string;
  tenantId: string;
  workspaceId: string;
  provider: string;
  externalTenantId: string;
  issuer: string | null;
  defaultRoleSlug: string;
  allowedEmailDomains: string[];
  jitEnabled: boolean;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  avatarUrl?: string;
}
