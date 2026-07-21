import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from './storage.service';
import type { AppConfigService } from '../config/app-config.service';
import type { ResilienceService } from '../resilience/resilience.service';

/**
 * These assert the CONTRACT BETWEEN the presigned URL and the headers the client
 * is told to send. That contract is invisible to type checking and was wrong in
 * production: presignPut advertised `x-amz-checksum-sha256` as required, but the
 * presigner never signed it. S3/R2 rejects an unsigned x-amz-* header with a 403
 * whose response carries no CORS headers, so the browser reported an opaque
 * "Failed to fetch" and every upload failed.
 *
 * Nothing else catches this — the SDK ignores the checksum silently, and no
 * mock-based test that stubs the SDK can see it. So these tests use the REAL
 * presigner and inspect the URL it emits.
 */
describe('StorageService — presigned PUT contract', () => {
  let service: StorageService;

  const config = {
    get: (k: string) =>
      (
        ({
          S3_ATTACHMENTS_BUCKET: 'rally-test-attachments',
          S3_PUBLIC_ASSETS_BUCKET: 'rally-test-public',
          CDN_PUBLIC_ASSETS_BASE_URL: undefined,
          STORAGE_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
          STORAGE_ACCESS_KEY_ID: 'AKIAEXAMPLE',
          STORAGE_SECRET_ACCESS_KEY: 'secretexample',
          STORAGE_FORCE_PATH_STYLE: true,
          AWS_REGION: 'ap-southeast-1',
        }) as Record<string, unknown>
      )[k],
  } as unknown as AppConfigService;

  // Pass through, so the real presigner runs.
  const resilience = {
    execute: <T>(_n: string, fn: () => Promise<T>) => fn(),
  } as unknown as ResilienceService;

  beforeEach(() => {
    service = new StorageService(config, resilience);
  });

  const presign = () =>
    service.presignPut({
      key: 'work-item-attachment/ws/file.png',
      mimeType: 'image/png',
      sizeBytes: 1234,
      visibility: 'private',
    });

  it('requires exactly the headers the signature covers', async () => {
    const { uploadUrl, requiredHeaders } = await presign();
    const signed = decodeURIComponent(
      new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '',
    )
      .split(';')
      .filter((h) => h !== 'host');

    // Every advertised header must be signed …
    for (const name of Object.keys(requiredHeaders)) {
      expect(signed).toContain(name.toLowerCase());
    }
    // … and no x-amz-* header may be advertised that the signature omits.
    const unsignedAmz = Object.keys(requiredHeaders).filter(
      (h) => h.toLowerCase().startsWith('x-amz-') && !signed.includes(h.toLowerCase()),
    );
    expect(unsignedAmz).toEqual([]);
  });

  it('does not advertise a checksum header — a presigned PUT cannot carry one', async () => {
    const { uploadUrl, requiredHeaders } = await presign();
    expect(Object.keys(requiredHeaders)).toEqual(['Content-Type']);
    expect(new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders')).not.toContain('checksum');
  });

  it('binds content-type and content-length so the bucket rejects at the edge', async () => {
    const { uploadUrl } = await presign();
    const signed = decodeURIComponent(
      new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '',
    );
    expect(signed).toContain('content-type');
    expect(signed).toContain('content-length');
  });

  it('refuses to store a public asset when no public bucket is configured', () => {
    const noPublic = {
      get: (k: string) =>
        k === 'S3_PUBLIC_ASSETS_BUCKET' ? undefined : (config.get as (key: string) => unknown)(k),
    } as unknown as AppConfigService;
    const svc = new StorageService(noPublic, resilience);
    // Must throw rather than silently fall back to the private bucket.
    return expect(
      svc.presignPut({ key: 'k', mimeType: 'image/png', sizeBytes: 1, visibility: 'public' }),
    ).rejects.toThrow(/S3_PUBLIC_ASSETS_BUCKET/);
  });
});
