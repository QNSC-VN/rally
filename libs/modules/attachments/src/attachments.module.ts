import { Module } from '@nestjs/common';
import { AccessModule } from '@modules/access';
import { ActivityModule } from '@modules/activity';
import { AttachmentsService } from './application/attachments.service';
import { EntityAttachmentsService } from './application/entity-attachments.service';
import { FileDrizzleRepository } from './infrastructure/persistence/file.drizzle-repository';
import { AttachmentDrizzleRepository } from './infrastructure/persistence/attachment.drizzle-repository';
import { FILE_REPOSITORY } from './domain/ports/file.repository';
import { ATTACHMENT_REPOSITORY } from './domain/ports/attachment.repository';

/**
 * Shared upload mechanics. Owning modules (work-items, portfolio, collaboration, identity)
 * import this module, authorize the actor against their own entity, then delegate.
 *
 * `EntityAttachmentsService` and the link-table repository moved here in 0083, when
 * `work_item_attachments` became the polymorphic `work.attachments`: the link table serves
 * more than one entity now, so it no longer belongs to work-items. What did NOT move is
 * authorization — see that service's doc comment.
 *
 * Deliberately exposes no controller: there is no generic `POST /uploads/presign`. Routes
 * stay with the owning context so that authorization cannot be reduced to an owner-type
 * registry lookup, which is where cross-tenant bugs hide.
 */
@Module({
  imports: [AccessModule, ActivityModule],
  providers: [
    AttachmentsService,
    EntityAttachmentsService,
    // StorageService is provided globally by PlatformModule.
    { provide: FILE_REPOSITORY, useClass: FileDrizzleRepository },
    { provide: ATTACHMENT_REPOSITORY, useClass: AttachmentDrizzleRepository },
  ],
  exports: [AttachmentsService, EntityAttachmentsService],
})
export class AttachmentsModule {}
