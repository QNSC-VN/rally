import { Global, Module } from '@nestjs/common';
import { DRIZZLE, DrizzleProvider } from './drizzle.provider';
import { UNIT_OF_WORK, UnitOfWork } from './unit-of-work';
import { DbPoolMetrics } from '@qnsc-vn/observability';

@Global()
@Module({
  providers: [
    // DbPoolMetrics is provided here, not only in PlatformModule: DrizzleProvider
    // injects it, and DatabaseModule must be able to construct on its own.
    DbPoolMetrics,
    DrizzleProvider,
    { provide: DRIZZLE, useFactory: (p: DrizzleProvider) => p.instance, inject: [DrizzleProvider] },
    { provide: UNIT_OF_WORK, useClass: UnitOfWork },
    UnitOfWork,
  ],
  exports: [DRIZZLE, UNIT_OF_WORK, UnitOfWork, DrizzleProvider],
})
export class DatabaseModule {}
