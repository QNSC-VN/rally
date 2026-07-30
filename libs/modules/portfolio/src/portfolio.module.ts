import { Module } from '@nestjs/common';
import { AccessModule } from '@modules/access';
import { ProjectsModule } from '@modules/projects';
import { PortfolioItemsService } from './application/portfolio-items.service';
import { PreliminaryEstimateMapService } from './application/preliminary-estimate-map.service';
import { PortfolioItemsController } from './interface/http/portfolio-items.controller';
import { PortfolioItemDrizzleRepository } from './infrastructure/persistence/portfolio-item.drizzle-repository';
import { PORTFOLIO_ITEM_REPOSITORY } from './domain/ports/portfolio-item.repository';

/**
 * P5.1 Portfolio Items — Epic and Feature.
 *
 * Read-only in this slice: list, detail, children and an Epic's child Features. Write
 * paths (create/edit/archive/rank) land next, and capacity planning depends on this
 * module rather than the reverse.
 */
@Module({
  imports: [AccessModule, ProjectsModule],
  controllers: [PortfolioItemsController],
  providers: [
    PortfolioItemsService,
    PreliminaryEstimateMapService,
    { provide: PORTFOLIO_ITEM_REPOSITORY, useClass: PortfolioItemDrizzleRepository },
  ],
  exports: [PortfolioItemsService, PreliminaryEstimateMapService],
})
export class PortfolioModule {}
