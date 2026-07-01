import { Module } from '@nestjs/common';
import { CollaborationService } from './application/collaboration.service';
import { CollaborationController } from './interface/http/collaboration.controller';
import { CommentDrizzleRepository } from './infrastructure/persistence/comment.drizzle-repository';
import { AttachmentDrizzleRepository } from './infrastructure/persistence/attachment.drizzle-repository';
import { COMMENT_REPOSITORY } from './domain/ports/comment.repository';
import { ATTACHMENT_REPOSITORY } from './domain/ports/attachment.repository';

@Module({
  controllers: [CollaborationController],
  providers: [
    CollaborationService,
    { provide: COMMENT_REPOSITORY, useClass: CommentDrizzleRepository },
    { provide: ATTACHMENT_REPOSITORY, useClass: AttachmentDrizzleRepository },
  ],
  exports: [CollaborationService],
})
export class CollaborationModule {}
