import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '@qnsc-vn/platform-cache';
import type { SecurityMetrics } from '@qnsc-vn/observability';
import { AuthzEpochService } from './authz-epoch.service';

/** Minimal ioredis pipeline double — records the INCRs it was handed. */
function pipelineDouble() {
  const incrs: string[] = [];
  return {
    incrs,
    pipeline: {
      incr: (key: string) => {
        incrs.push(key);
        return undefined;
      },
      exec: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('AuthzEpochService', () => {
  let cache: {
    get: ReturnType<typeof vi.fn>;
    isAvailable: boolean;
    redis: unknown;
  };
  let pipe: ReturnType<typeof pipelineDouble>;
  let metrics: {
    recordFailOpen: ReturnType<typeof vi.fn>;
    recordStaleToken: ReturnType<typeof vi.fn>;
  };
  let service: AuthzEpochService;

  beforeEach(() => {
    pipe = pipelineDouble();
    cache = {
      get: vi.fn().mockResolvedValue(null),
      isAvailable: true,
      redis: { pipeline: () => pipe.pipeline },
    };
    metrics = {
      recordFailOpen: vi.fn(),
      recordStaleToken: vi.fn(),
    };
    service = new AuthzEpochService(
      cache as unknown as CacheService,
      metrics as unknown as SecurityMetrics,
    );
  });

  describe('current', () => {
    it('reads 0 for a user who has never had a permission change', async () => {
      await expect(service.current('user-1')).resolves.toBe(0);
      expect(cache.get).toHaveBeenCalledWith('authz:epoch:user-1');
    });

    it('parses a stored epoch', async () => {
      cache.get.mockResolvedValue('12');
      await expect(service.current('user-1')).resolves.toBe(12);
    });

    it('returns null (unknown) when the cache is disabled', async () => {
      // A disabled cache also answers `get` with null — reporting 0 there would
      // make every epoch-stamped token look stale forever.
      cache.isAvailable = false;
      await expect(service.current('user-1')).resolves.toBeNull();
    });

    it('returns null (unknown) when the lookup throws', async () => {
      cache.get.mockRejectedValue(new Error('ECONNRESET'));
      await expect(service.current('user-1')).resolves.toBeNull();
    });

    it('treats a corrupt stored value as 0 rather than unknown', async () => {
      cache.get.mockResolvedValue('not-a-number');
      await expect(service.current('user-1')).resolves.toBe(0);
    });
  });

  describe('isStale', () => {
    it('is stale when the current epoch is ahead of the token', async () => {
      cache.get.mockResolvedValue('5');
      await expect(service.isStale('user-1', 4)).resolves.toBe(true);
    });

    it('is not stale when the token is at the current epoch', async () => {
      cache.get.mockResolvedValue('5');
      await expect(service.isStale('user-1', 5)).resolves.toBe(false);
    });

    it('treats a token with no epoch claim as epoch 0', async () => {
      cache.get.mockResolvedValue('1');
      await expect(service.isStale('user-1', undefined)).resolves.toBe(true);
    });

    it('admits a pre-epoch token while no bump has ever happened', async () => {
      await expect(service.isStale('user-1', undefined)).resolves.toBe(false);
    });

    it('does NOT reject a token whose epoch is ahead of the store (cache flush)', async () => {
      // Losing the counter must never invalidate valid tokens — only a HIGHER
      // current epoch means a real permission change.
      cache.get.mockResolvedValue('0');
      await expect(service.isStale('user-1', 9)).resolves.toBe(false);
    });

    it('fails open when the epoch is unreadable', async () => {
      cache.get.mockRejectedValue(new Error('down'));
      await expect(service.isStale('user-1', 1)).resolves.toBe(false);
    });
  });

  describe('bump', () => {
    it('increments the user key', async () => {
      await service.bump('user-1');
      expect(pipe.incrs).toEqual(['authz:epoch:user-1']);
      expect(pipe.pipeline.exec).toHaveBeenCalled();
    });

    it('increments each user once, de-duplicated, in a single round-trip', async () => {
      await service.bumpMany(['user-1', 'user-2', 'user-1']);
      expect(pipe.incrs).toEqual(['authz:epoch:user-1', 'authz:epoch:user-2']);
      expect(pipe.pipeline.exec).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for an empty list', async () => {
      await service.bumpMany([]);
      expect(pipe.pipeline.exec).not.toHaveBeenCalled();
    });

    it('does not throw when the cache is unavailable', async () => {
      // The caller's permission write has already committed; turning a cache
      // outage into a thrown error would misreport a change that did happen.
      cache.redis = null;
      await expect(service.bump('user-1')).resolves.toBeUndefined();
    });

    it('does not throw when the pipeline fails', async () => {
      pipe.pipeline.exec.mockRejectedValue(new Error('broken pipe'));
      await expect(service.bump('user-1')).resolves.toBeUndefined();
    });
  });
});
