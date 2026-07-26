import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@qnsc-vn/platform-cache';
import { failOpenLog, SecurityMetrics } from '@qnsc-vn/observability';

/** Valkey key prefix for the per-user authorization epoch counter. */
const AUTHZ_EPOCH_PREFIX = 'authz:epoch:';

/**
 * Per-user **authorization epoch** — a monotonic counter that invalidates
 * already-minted access tokens the moment a user's effective permissions change.
 *
 * Why this exists: a token carries `claims.permissions` resolved at mint time,
 * and `PermissionGuard` authorizes from that snapshot without touching the
 * database. Without an epoch, revoking a role only takes effect when the token
 * next rotates — up to `JWT_ACCESS_EXPIRY` (15m) later. Every permission-changing
 * write bumps the epoch; {@link JwtAuthGuard} compares the epoch stamped into the
 * token against the current one and rejects (Bearer) or transparently re-mints
 * (BFF) when the token is behind.
 *
 * The counter is deliberately *not* the permission set itself — it is one small
 * integer read in the same round-trip as the existing denylist lookups, so the
 * hot path gains no extra latency tier.
 *
 * Failure policy: **fails open, loudly.** {@link current} returns `null` when the
 * epoch cannot be read (cache disabled or unreachable), which the guard treats as
 * "unknown — allow", preserving today's behaviour rather than converting a Valkey
 * blip into a fleet-wide logout. Both failure paths increment a counter so the
 * outage is visible instead of silent.
 *
 * A lost counter (cache flush) is safe by construction: the epoch reads back as 0,
 * which is never *greater* than a token's stamped epoch, so no token is falsely
 * rejected. The next real permission change re-establishes a higher value.
 */
@Injectable()
export class AuthzEpochService {
  private readonly logger = new Logger(AuthzEpochService.name);

  /**
   * Instruments come from the shared package rather than local counters. This class
   * previously declared three of its own via BaseMetrics, which would now duplicate
   * `authz.stale_token` and `security.fail_open` — two instruments for one signal
   * means dashboards disagree with each other. The `control` label distinguishes
   * which degradation happened.
   */
  constructor(
    private readonly cache: CacheService,
    private readonly metrics: SecurityMetrics,
  ) {}

  private key(userId: string): string {
    return `${AUTHZ_EPOCH_PREFIX}${userId}`;
  }

  /**
   * The user's current epoch, or `null` when it cannot be determined (cache
   * disabled or unreachable). A user who has never had a permission change has
   * no key and reads as `0`.
   */
  async current(userId: string): Promise<number | null> {
    try {
      const raw = await this.cache.get(this.key(userId));
      if (raw === null) {
        // Two cases collapse here: no key yet (epoch 0) and cache disabled.
        // Distinguish them so a disabled cache is reported as "unknown", not "0" —
        // otherwise a token stamped with a real epoch would look stale forever.
        return this.cache.isAvailable ? 0 : null;
      }
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (err) {
      this.logger.warn(
        failOpenLog('authz_epoch', { err, userId }),
        'Authz epoch lookup failed; allowing (fail-open)',
      );
      this.metrics.recordFailOpen('authz_epoch');
      return null;
    }
  }

  /**
   * Invalidate every access token already minted for `userId`.
   *
   * Call this AFTER the permission write has committed: a bump that outlives a
   * rolled-back transaction would force a pointless re-mint, and a bump made
   * before commit could be observed by a concurrent request that then re-mints
   * from the pre-commit state — the exact staleness this class removes.
   *
   * Never throws. The caller's write has already succeeded, so surfacing a cache
   * error as a failed request would misreport a completed change; the failure is
   * logged and counted instead.
   */
  async bump(userId: string): Promise<void> {
    return this.bumpMany([userId]);
  }

  /**
   * Bump several users in one round-trip. Used when a change fans out — e.g.
   * editing a role's permission set affects every holder of that role.
   */
  async bumpMany(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const unique = [...new Set(userIds)];
    try {
      const redis = this.cache.redis;
      if (!redis) {
        this.logger.error(
          { userIds: unique },
          'Authz epoch bump skipped — cache unavailable; permission change will only ' +
            'take effect on token expiry',
        );
        this.metrics.recordFailOpen('authz_epoch_bump');
        return;
      }
      const pipeline = redis.pipeline();
      for (const userId of unique) pipeline.incr(this.key(userId));
      await pipeline.exec();
      this.logger.debug({ count: unique.length }, 'Authz epoch bumped');
    } catch (err) {
      this.logger.error(
        { err, userIds: unique },
        'Authz epoch bump failed; permission change will only take effect on token expiry',
      );
      this.metrics.recordFailOpen('authz_epoch_bump');
    }
  }

  /**
   * Whether a token stamped with `tokenEpoch` is behind the user's current epoch.
   *
   * Uses `>` rather than `!==` on purpose: only a *higher* current epoch means a
   * permission change happened after the token was minted. A lower one can only
   * come from a cache flush, which must not invalidate valid tokens.
   */
  async isStale(userId: string, tokenEpoch: number | undefined): Promise<boolean> {
    const current = await this.current(userId);
    if (current === null) return false; // unknown — fail open
    const stamped = typeof tokenEpoch === 'number' ? tokenEpoch : 0;
    const stale = current > stamped;
    if (stale) this.metrics.recordStaleToken();
    return stale;
  }
}
