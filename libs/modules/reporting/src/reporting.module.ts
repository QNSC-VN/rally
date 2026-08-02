import { Module } from '@nestjs/common';
import { AccessModule } from '@modules/access';
import { PortfolioModule } from '@modules/portfolio';
import { ReportingService } from './application/reporting.service';
import { ReportSnapshotService } from './application/report-snapshot.service';
import { ReportingController } from './interface/http/reporting.controller';
import { ReportingDrizzleRepository } from './infrastructure/persistence/reporting.drizzle-repository';
import { REPORTING_REPOSITORY } from './domain/ports/reporting.repository';

// PortfolioModule for `PreliminaryEstimateMapService`: Release Tracking's Preliminary
// Estimate line falls back to the workspace's T-shirt-size mapping, and there must be one
// reader of that setting so the portfolio's Estimated Progress and this report cannot
// disagree about what "M" means.
@Module({
  imports: [AccessModule, PortfolioModule],
  controllers: [ReportingController],
  providers: [
    ReportingService,
    ReportSnapshotService,
    { provide: REPORTING_REPOSITORY, useClass: ReportingDrizzleRepository },
  ],
  exports: [ReportingService, ReportSnapshotService],
})
export class ReportingModule {}
