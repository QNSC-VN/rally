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
export * from './interface/http/dto/access-request.dto';
export * from './interface/http/dto/access-response.dto';
