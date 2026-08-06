import { Global, Module } from '@nestjs/common';
import { AccessModule } from '@modules/access';
import { AuditService } from './application/audit.service';
import { AuditController } from './interface/http/audit.controller';
import { AuditDrizzleRepository } from './infrastructure/persistence/audit.drizzle-repository';
import { AUDIT_REPOSITORY } from './domain/ports/audit.repository';

@Global()
@Module({
  // For the PolicyGuard behind `audit:view`. AccessService reaches AuditService
  // the other way round, but this module is @Global, so that direction needs no
  // import and the graph stays acyclic.
  imports: [AccessModule],
  controllers: [AuditController],
  providers: [AuditService, { provide: AUDIT_REPOSITORY, useClass: AuditDrizzleRepository }],
  // AUDIT_REPOSITORY is exported, not just provided: @Global() only globalises what a
  // module EXPORTS. The worker's AuditProjectionRelay injects the port directly because
  // AuditService swallows write errors, which a relay must see — see that class's
  // constructor comment.
  exports: [AuditService, AUDIT_REPOSITORY],
})
export class AuditModule {}
