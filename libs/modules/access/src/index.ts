export * from './access.module';
export * from './domain/access.types';
export * from './domain/ports/role.repository';
export * from './domain/ports/role-assignment.repository';
export * from './domain/ports/project-access.repository';
export * from './domain/project-access';
// Exported for the two projects repositories that read the same predicate — the roster and the
// roster's size. See the docblock: it moved here with the grant writer so there is still ONE home.
export * from './infrastructure/persistence/workspace-admin-ids';
export * from './application/access.service';
export * from './interface/http/policy.guard';
export * from './application/project-scope.resolver';
// `dto/access-request.dto.ts` is deleted, not emptied: with `AssignRoleSchema`,
// `UpdateRolePermissionsSchema`, `CreateRoleSchema` and `AssignProjectRoleSchema` all gone with their
// routes (ruling 2026-08-14, AC-11), the file held no exports — only two imports and a comment. A
// barrel entry for an empty module is how a deleted contract looks alive from the outside.
export * from './interface/http/dto/access-response.dto';
