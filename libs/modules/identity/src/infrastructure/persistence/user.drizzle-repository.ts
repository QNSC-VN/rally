import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { users, passwordResetTokens, ssoIdentities } from '../../../../../../db/schema/identity';
import type { User, UserStatus, SsoIdentity } from '../../domain/user.types';
import { IUserRepository } from '../../domain/ports/user.repository';

@Injectable()
export class UserDrizzleRepository implements IUserRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    input: {
      email: string;
      displayName: string;
      passwordHash: string;
      emailVerified?: boolean;
    },
    tx?: DbExecutor,
  ): Promise<User> {
    const [row] = await (tx ?? this.db)
      .insert(users)
      .values({
        id: uuidv7(),
        email: input.email.toLowerCase().trim(),
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        status: 'active',
        emailVerified: input.emailVerified ?? false,
      })
      .returning();
    return row as User;
  }

  async updateLastLogin(id: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db).update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }

  async updatePasswordHash(id: string, passwordHash: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateStatus(id: string, status: UserStatus, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateProfile(
    id: string,
    input: { displayName?: string; avatarUrl?: string | null; locale?: string; timezone?: string },
  ): Promise<User> {
    const rows = await this.db
      .update(users)
      .set({
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        ...(input.locale !== undefined && { locale: input.locale }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return rows[0] as User;
  }

  async createPasswordResetToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? this.db).insert(passwordResetTokens).values({
      id: uuidv7(),
      userId: id,
      tokenHash,
      expiresAt,
    });
  }

  async findPasswordResetToken(
    tokenHash: string,
  ): Promise<{ id: string; userId: string; usedAt: Date | null; expiresAt: Date } | null> {
    const rows = await this.db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        usedAt: passwordResetTokens.usedAt,
        expiresAt: passwordResetTokens.expiresAt,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async markPasswordResetTokenUsed(id: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  }

  // ── SSO ─────────────────────────────────────────────────────────────────────

  async findSsoIdentity(provider: string, providerSub: string): Promise<SsoIdentity | null> {
    const rows = await this.db
      .select()
      .from(ssoIdentities)
      .where(and(eq(ssoIdentities.provider, provider), eq(ssoIdentities.providerSub, providerSub)))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertBySsoIdentity(
    provider: string,
    providerSub: string,
    providerEmail: string,
    displayName: string,
    tenantId: string,
    tx?: DbExecutor,
  ): Promise<User> {
    const executor = tx ?? this.db;

    // 1. Check if this SSO identity is already linked
    const existingIdentity = await this.findSsoIdentity(provider, providerSub);
    if (existingIdentity) {
      // Update email if it changed (Entra allows email changes)
      if (existingIdentity.providerEmail !== providerEmail) {
        await executor
          .update(ssoIdentities)
          .set({ providerEmail, updatedAt: new Date() })
          .where(eq(ssoIdentities.id, existingIdentity.id));
      }
      const user = await this.findById(existingIdentity.userId);
      return user!;
    }

    // 2. Try to match an existing user by email (account merge for pre-invited users)
    const emailNormalized = providerEmail.toLowerCase().trim();
    const existingUser = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, emailNormalized), isNull(users.deletedAt)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (existingUser) {
      // Link the SSO identity to the existing user (tenantId = SSO connection's tenant)
      await executor.insert(ssoIdentities).values({
        id: uuidv7(),
        tenantId,
        userId: existingUser.id,
        provider,
        providerSub,
        providerEmail,
      });
      return existingUser;
    }

    // 3. JIT provision: create new user + sso_identity in the specified tenant
    const userId = uuidv7();
    const [newUser] = await executor
      .insert(users)
      .values({
        id: userId,
        email: emailNormalized,
        displayName,
        status: 'active',
        emailVerified: true, // Entra ID has already verified the email
        passwordHash: null,
      })
      .returning();

    await executor.insert(ssoIdentities).values({
      id: uuidv7(),
      tenantId,
      userId,
      provider,
      providerSub,
      providerEmail,
    });

    return newUser!;
  }
}
