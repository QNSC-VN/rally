import { Global, Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';
import { AuditController } from './interface/http/audit.controller';
import { AuditDrizzleRepository } from './infrastructure/persistence/audit.drizzle-repository';
import { AUDIT_REPOSITORY } from './domain/ports/audit.repository';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, { provide: AUDIT_REPOSITORY, useClass: AuditDrizzleRepository }],
  exports: [AuditService],
})
export class AuditModule {}
