import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Typed config service wrapper.
 * Exposes get<K extends keyof Env> so callers get the typed value, not a raw string.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** True when packaged for a single customer (one tenant, no self-serve signup). */
  isSingleTenant(): boolean {
    return this.get('DEPLOYMENT_MODE') === 'single';
  }
}
