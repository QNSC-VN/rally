import { Module } from '@nestjs/common';
import { AccessModule } from '@modules/access';
import { CapacityPlansService } from './application/capacity-plans.service';
import { CapacityPlansController } from './interface/http/capacity-plans.controller';
import { CapacityPlanDrizzleRepository } from './infrastructure/persistence/capacity-plan.drizzle-repository';
import { CAPACITY_PLAN_REPOSITORY } from './domain/ports/capacity-plan.repository';

/**
 * P5.2 Capacity Planning — one plan per (project, release).
 *
 * This slice covers plan CRUD and team membership with manually entered capacity.
 * Allocations (the demand side) and the derived Complete/Rollup/Estimated metrics land
 * next; publish, which writes back to Feature release/date fields, comes last behind its
 * own `capacity:publish` gate.
 *
 * Depends on the portfolio module only from the next slice onwards — allocations point at
 * portfolio items — so it is deliberately not imported yet.
 */
@Module({
  imports: [AccessModule],
  controllers: [CapacityPlansController],
  providers: [
    CapacityPlansService,
    { provide: CAPACITY_PLAN_REPOSITORY, useClass: CapacityPlanDrizzleRepository },
  ],
  exports: [CapacityPlansService],
})
export class CapacityModule {}
