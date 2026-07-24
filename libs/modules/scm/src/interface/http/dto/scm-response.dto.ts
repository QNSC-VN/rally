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

export const ScmRepositoryResponseSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(scmProviderEnum.enumValues),
  fullName: z.string(),
  baseUrl: z.string().nullable(),
  active: z.boolean(),
  projectIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
});
export class ScmRepositoryResponseDto extends createZodDto(ScmRepositoryResponseSchema) {}

export const ScmSyncResponseSchema = z.object({
  enqueued: z.boolean().describe('True when a backfill job was queued'),
});
export class ScmSyncResponseDto extends createZodDto(ScmSyncResponseSchema) {}
