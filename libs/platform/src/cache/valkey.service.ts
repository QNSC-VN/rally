import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/**
 * Valkey / Redis client service.
 * Used for: rate-limiting token buckets, access-token denylist, distributed locks.
 */
@Injectable()
export class ValkeyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ValkeyService.name);
  private client!: Redis;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.get('REDIS_URL'), {
      keyPrefix: this.config.get('REDIS_KEY_PREFIX'),
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    this.client.on('error', (err) => this.logger.error({ err }, 'Valkey connection error'));
    this.client.on('ready', () => this.logger.log('Valkey ready'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  get instance(): Redis {
    return this.client;
  }

  // ── Denylist ─────────────────────────────────────────────────────────────────

  async denylistToken(jti: string, ttlSeconds: number): Promise<void> {
    await this.client.set(`denylist:${jti}`, '1', 'EX', ttlSeconds);
  }

  async isTokenDenied(jti: string): Promise<boolean> {
    const val = await this.client.get(`denylist:${jti}`);
    return val !== null;
  }

  // ── Rate-limit token bucket (sliding window) ─────────────────────────────────

  /**
   * Check + consume one token from a bucket.
   * Returns { allowed, remaining, resetAt }.
   */
  async consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `rl:${key}:${Math.floor(now / windowSeconds)}`;
    const resetAt = (Math.floor(now / windowSeconds) + 1) * windowSeconds;

    const current = await this.client
      .multi()
      .incr(windowKey)
      .expire(windowKey, windowSeconds)
      .exec();

    const count = (current?.[0]?.[1] as number) ?? 1;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);

    return { allowed, remaining, resetAt };
  }

  // ── User-level fast revocation ─────────────────────────────────────────────
  //
  // Used when an admin suspends / deactivates a user account. Sets a Redis key
  // that the JWT guard checks on every request — active access tokens (up to
  // 15 min lifetime) are immediately invalidated without waiting for expiry.

  /**
   * Fast-revoke ALL active access tokens for a user.
   * TTL should match the longest possible access-token lifetime (JWT_ACCESS_EXPIRY).
   */
  async revokeUser(userId: string, ttlSeconds: number): Promise<void> {
    await this.client.set(`denylist:user:${userId}`, '1', 'EX', ttlSeconds);
  }

  async isUserRevoked(userId: string): Promise<boolean> {
    const val = await this.client.get(`denylist:user:${userId}`);
    return val !== null;
  }

  // ── Distributed locks (Redlock-lite via SET NX PX) ───────────────────────────

  /**
   * Attempt to acquire a distributed lock.
   * Returns true if the lock was acquired, false if already held by another holder.
   * The lock auto-expires after ttlMs to prevent deadlocks on pod crash.
   */
  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(`lock:${key}`, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  /**
   * Release a distributed lock.
   * Safe to call even if the lock has already expired.
   */
  async releaseLock(key: string): Promise<void> {
    await this.client.del(`lock:${key}`);
  }
}
