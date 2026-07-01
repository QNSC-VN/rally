import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { InjectDrizzle } from '../database/drizzle.provider';
import type { DrizzleDB } from '../database/drizzle.provider';
import { sql } from 'drizzle-orm';
import { ValkeyService } from '../cache/valkey.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly valkey: ValkeyService,
  ) {}

  /** Liveness probe — is the process alive? */
  @Get('healthz')
  @Public()
  @SkipRateLimit()
  @ApiOperation({ summary: 'Liveness probe — returns ok if process is alive' })
  @ApiResponse({
    status: 200,
    schema: { properties: { status: { type: 'string', example: 'ok' } } },
  })
  healthz() {
    return { status: 'ok' };
  }

  /** Readiness probe — can we serve traffic? (DB + cache reachable) */
  @Get('readyz')
  @Public()
  @SkipRateLimit()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — checks DB and cache connectivity' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: { status: { type: 'string', example: 'ok' }, details: { type: 'object' } },
    },
  })
  async readyz() {
    return this.health.check([
      async () => {
        try {
          await this.db.execute(sql`SELECT 1`);
          return { postgres: { status: 'up' } };
        } catch (e) {
          return { postgres: { status: 'down', error: String(e) } };
        }
      },
      async () => {
        try {
          await this.valkey.instance.ping();
          return { valkey: { status: 'up' } };
        } catch (e) {
          return { valkey: { status: 'down', error: String(e) } };
        }
      },
    ]);
  }
}
