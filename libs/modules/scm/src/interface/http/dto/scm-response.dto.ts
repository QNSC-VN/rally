import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { scmProviderEnum, scmConnectionTypeEnum } from '../../../../../../../db/schema/enums';
import { SCM_CHANGE_ACTIONS } from '../../../domain/scm.types';

export const ScmConnectionResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  provider: z.enum(scmProviderEnum.enumValues),
  type: z.enum(scmConnectionTypeEnum.enumValues),
  name: z.string(),
  url: z.string(),
  state: z.string().nullable(),
  authorName: z.string().nullable(),
  createdAt: z
    .string()
    .datetime()
    .describe("Artifact's source creation time (falls back to ingest time)"),
});
export class ScmConnectionResponseDto extends createZodDto(ScmConnectionResponseSchema) {}

const ScmChangeSchema = z.object({
  action: z.enum(SCM_CHANGE_ACTIONS),
  path: z.string(),
});

export const ScmChangesetResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  provider: z.enum(scmProviderEnum.enumValues),
  revision: z.string(),
  name: z.string(),
  message: z.string().nullable(),
  uri: z.string().nullable(),
  authorName: z.string().nullable(),
  changes: z.array(ScmChangeSchema),
  committedAt: z.string().datetime().nullable(),
});
export class ScmChangesetResponseDto extends createZodDto(ScmChangesetResponseSchema) {}

const ScmLastSyncSchema = z.object({
  status: z.enum(['pending', 'done', 'failed']),
  at: z.string().datetime().nullable(),
  prs: z.number().int(),
  commits: z.number().int(),
});

export const ScmRepositoryResponseSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(scmProviderEnum.enumValues),
  fullName: z.string(),
  baseUrl: z.string().nullable(),
  active: z.boolean(),
  installationId: z.string().nullable(),
  /** Latest backfill outcome (null until a job has run). */
  lastSync: ScmLastSyncSchema.nullable(),
  createdAt: z.string().datetime(),
});
export class ScmRepositoryResponseDto extends createZodDto(ScmRepositoryResponseSchema) {}

export const ScmInstallationResponseSchema = z.object({
  installationId: z.string(),
  accountLogin: z.string().nullable(),
  accountType: z.string().nullable(),
  /** For the /available list: already bound to this workspace. */
  connected: z.boolean().optional(),
});
export class ScmInstallationResponseDto extends createZodDto(ScmInstallationResponseSchema) {}

export const ScmSyncResponseSchema = z.object({
  enqueued: z.boolean().describe('True when a backfill job was queued'),
});
export class ScmSyncResponseDto extends createZodDto(ScmSyncResponseSchema) {}

export const ScmConnectResponseSchema = z.object({
  discovered: z.number().int().describe('Repositories discovered + queued for backfill'),
});
export class ScmConnectResponseDto extends createZodDto(ScmConnectResponseSchema) {}
