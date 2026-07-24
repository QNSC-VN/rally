import { describe, it, expect, vi } from 'vitest';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { AppConfigService } from '@platform';
import { SecretsManagerSecretResolver } from './secrets-manager-secret-resolver';

const config = {} as AppConfigService; // unused when a client is injected

function makeResolver(send: ReturnType<typeof vi.fn>) {
  const client = { send } as unknown as SecretsManagerClient;
  return new SecretsManagerSecretResolver(config, client);
}

describe('SecretsManagerSecretResolver', () => {
  it('fetches and returns the SecretString', async () => {
    const send = vi.fn().mockResolvedValue({ SecretString: 's3cr3t' });
    expect(await makeResolver(send).get('rally/dev/sso/home')).toBe('s3cr3t');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caches within the TTL (one fetch for repeated refs)', async () => {
    const send = vi.fn().mockResolvedValue({ SecretString: 's3cr3t' });
    const r = makeResolver(send);
    await r.get('rally/dev/sso/home');
    await r.get('rally/dev/sso/home');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fetches distinct refs separately', async () => {
    const send = vi.fn().mockResolvedValue({ SecretString: 's3cr3t' });
    const r = makeResolver(send);
    await r.get('rally/dev/sso/a');
    await r.get('rally/dev/sso/b');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('throws when the secret has no string value (empty or binary-only)', async () => {
    const send = vi.fn().mockResolvedValue({ SecretString: undefined });
    await expect(makeResolver(send).get('rally/dev/sso/home')).rejects.toThrow(
      /empty or binary-only/,
    );
  });
});
