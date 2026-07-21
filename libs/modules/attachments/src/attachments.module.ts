import { Module } from '@nestjs/common';
import { AttachmentsService } from './application/attachments.service';
import { FileDrizzleRepository } from './infrastructure/persistence/file.drizzle-repository';
import { FILE_REPOSITORY } from './domain/ports/file.repository';

/**
 * Shared upload mechanics. Exports AttachmentsService only — owning modules
 * (work-items, collaboration, identity) import this module, authorize the actor
 * against their own entity, then delegate.
 *
 * Deliberately exposes no controller: there is no generic
 * `POST /uploads/presign`. Routes stay with the owning context so that
 * authorization cannot be reduced to an owner-type registry lookup, which is
 * where cross-tenant bugs hide.
 */
@Module({
  providers: [
    AttachmentsService,
    // StorageService is provided globally by PlatformModule.
    { provide: FILE_REPOSITORY, useClass: FileDrizzleRepository },
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
