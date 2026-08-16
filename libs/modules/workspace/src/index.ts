export * from './workspace.module';
export * from './domain/workspace.types';
export * from './domain/ports/workspace.repository';
export * from './domain/ports/workspace-member.repository';
export * from './application/workspace.service';
export * from './application/guest-invite-scheduler.service';
/**
 * Exported for the WORKER, which registers the client as a plain provider rather than importing
 * WorkspaceModule: the client's only dependencies (AppConfigService, ResilienceService) are global
 * from PlatformModule, and importing the whole module would instantiate three HTTP controllers in a
 * process that has no HTTP adapter.
 */
export * from './infrastructure/entra/entra-guest-invite.client';
export * from './interface/http/dto/workspace-request.dto';
export * from './interface/http/dto/workspace-response.dto';
export * from './domain/team.types';
export * from './domain/ports/team.repository';
export * from './domain/ports/team-member.repository';
export * from './application/team.service';
