import { Module } from '@nestjs/common';
import { WorkItemsModule } from '@modules/work-items';
import { AccessModule } from '@modules/access';
import { CollaborationService } from './application/collaboration.service';
import { CollaborationController } from './interface/http/collaboration.controller';
import { CommentDrizzleRepository } from './infrastructure/persistence/comment.drizzle-repository';
import { COMMENT_REPOSITORY } from './domain/ports/comment.repository';

@Module({
  imports: [WorkItemsModule, AccessModule],
  controllers: [CollaborationController],
  providers: [
    CollaborationService,
    { provide: COMMENT_REPOSITORY, useClass: CommentDrizzleRepository },
  ],
  exports: [CollaborationService],
})
export class CollaborationModule {}
