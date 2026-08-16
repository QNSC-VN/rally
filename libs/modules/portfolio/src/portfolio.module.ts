import { Module } from '@nestjs/common';
import { AttachmentsModule } from '@modules/attachments';
import { AccessModule } from '@modules/access';
import { ActivityModule } from '@modules/activity';
import { ProjectsModule } from '@modules/projects';
// The milestone-artifact scope rule has ONE home (`assertArtifactsInMilestoneScope`) and all three
// writers of `milestone_artifacts` reach it through `MilestonesService` — including this module's
// `milestoneIds` patch. Safe to import: MilestonesModule does not import this one. Same note, same
// reason, as `WorkItemsModule` carries.
import { MilestonesModule } from '@modules/milestones';
import { PortfolioItemsService } from './application/portfolio-items.service';
import { PreliminaryEstimateMapService } from './application/preliminary-estimate-map.service';
import { PortfolioAttachmentsController } from './interface/http/portfolio-attachments.controller';
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
  imports: [AccessModule, ProjectsModule, ActivityModule, AttachmentsModule, MilestonesModule],
  controllers: [PortfolioItemsController, PortfolioAttachmentsController],
  providers: [
    PortfolioItemsService,
    PreliminaryEstimateMapService,
    { provide: PORTFOLIO_ITEM_REPOSITORY, useClass: PortfolioItemDrizzleRepository },
  ],
  exports: [PortfolioItemsService, PreliminaryEstimateMapService],
})
export class PortfolioModule {}
