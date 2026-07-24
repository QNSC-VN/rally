import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ScmConnectionResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  provider: z.enum(['github', 'ghe']),
  type: z.enum(['pull_request', 'build', 'branch']),
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
  action: z.enum(['A', 'M', 'D']),
  path: z.string(),
});

export const ScmChangesetResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  provider: z.enum(['github', 'ghe']),
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
  provider: z.enum(['github', 'ghe']),
  fullName: z.string(),
  baseUrl: z.string().nullable(),
  active: z.boolean(),
  projectIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
});
export class ScmRepositoryResponseDto extends createZodDto(ScmRepositoryResponseSchema) {}
