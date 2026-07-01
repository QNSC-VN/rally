import { Module } from '@nestjs/common';
import { AccessService } from './application/access.service';
import { AccessController } from './interface/http/access.controller';
import { RoleDrizzleRepository } from './infrastructure/persistence/role.drizzle-repository';
import { RoleAssignmentDrizzleRepository } from './infrastructure/persistence/role-assignment.drizzle-repository';
import { ROLE_REPOSITORY } from './domain/ports/role.repository';
import { ROLE_ASSIGNMENT_REPOSITORY } from './domain/ports/role-assignment.repository';

@Module({
  controllers: [AccessController],
  providers: [
    AccessService,
    { provide: ROLE_REPOSITORY, useClass: RoleDrizzleRepository },
    { provide: ROLE_ASSIGNMENT_REPOSITORY, useClass: RoleAssignmentDrizzleRepository },
  ],
  exports: [AccessService],
})
export class AccessModule {}
