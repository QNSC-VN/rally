import { Module } from '@nestjs/common';
import { ReportingService } from './application/reporting.service';
import { ReportingController } from './interface/http/reporting.controller';
import { ReportingDrizzleRepository } from './infrastructure/persistence/reporting.drizzle-repository';
import { REPORTING_REPOSITORY } from './domain/ports/reporting.repository';

@Module({
  controllers: [ReportingController],
  providers: [
    ReportingService,
    { provide: REPORTING_REPOSITORY, useClass: ReportingDrizzleRepository },
  ],
  exports: [ReportingService],
})
export class ReportingModule {}
