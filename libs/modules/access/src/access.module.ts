import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AccessService } from './application/access.service';
import { ProjectScopeResolver } from './application/project-scope.resolver';
import { AccessController } from './interface/http/access.controller';
import { RouteAuthzAudit } from './interface/http/route-authz-audit';
import { PolicyGuard } from './interface/http/policy.guard';
import { RoleDrizzleRepository } from './infrastructure/persistence/role.drizzle-repository';
import { RoleAssignmentDrizzleRepository } from './infrastructure/persistence/role-assignment.drizzle-repository';
import { ROLE_REPOSITORY } from './domain/ports/role.repository';
import { ROLE_ASSIGNMENT_REPOSITORY } from './domain/ports/role-assignment.repository';

@Module({
  // DiscoveryModule gives RouteAuthzAudit the controller inventory it scans at bootstrap.
  imports: [DiscoveryModule],
  controllers: [AccessController],
  providers: [
    // Refuses to finish bootstrapping if any route declares no authorization. A provider so it
    // runs for every app importing this module, including the e2e harness, with no call site
    // anyone can forget.
    RouteAuthzAudit,
    AccessService,
    ProjectScopeResolver,
    PolicyGuard,
    { provide: ROLE_REPOSITORY, useClass: RoleDrizzleRepository },
    { provide: ROLE_ASSIGNMENT_REPOSITORY, useClass: RoleAssignmentDrizzleRepository },
  ],
  exports: [AccessService, ProjectScopeResolver, PolicyGuard],
})
export class AccessModule {}
