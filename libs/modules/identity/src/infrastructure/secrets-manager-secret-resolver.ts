import { Injectable } from '@nestjs/common';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { AppConfigService, buildAwsClientConfig } from '@platform';
import type { ISecretResolver } from '@qnsc-vn/identity';

/**
 * Resolves per-connection OIDC client secrets from AWS Secrets Manager — the
 * infra's paved path for sensitive values (CMK-encrypted; created empty in IaC,
 * value set out-of-band). Secrets live under `rally/${env}/sso/*`. Fetched at
 * use by the ECS task role (runtime), in-memory TTL-cached.
 */
@Injectable()
export class SecretsManagerSecretResolver implements ISecretResolver {
  private readonly client: SecretsManagerClient;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();
  private readonly ttlMs = 300_000;

  constructor(config: AppConfigService) {
    this.client = new SecretsManagerClient(buildAwsClientConfig(config));
  }

  async get(ref: string): Promise<string> {
    const hit = this.cache.get(ref);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const out = await this.client.send(new GetSecretValueCommand({ SecretId: ref }));
    const value = out.SecretString;
    if (!value) {
      throw new Error(`Secrets Manager secret is empty or binary-only: ${ref}`);
    }
    this.cache.set(ref, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }
}
