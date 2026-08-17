import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  defectSeverityEnum,
  defectEnvironmentEnum,
  defectRootCauseEnum,
  defectResolutionEnum,
} from '../../../../../../../db/schema/enums';

export const DefectMetricsSchema = z.object({
  openDefects: z.number(),
  critical: z.number(),
  inProgress: z.number(),
  verifiedAccepted: z.number(),
  reopened: z.number(),
  blockers: z.number(),
});

export const DefectRowSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string(),
  title: z.string(),
  type: z.string(),
  priority: z.string(),
  severity: z.enum(defectSeverityEnum.enumValues).nullable(),
  foundInEnvironment: z.enum(defectEnvironmentEnum.enumValues).nullable(),
  rootCause: z.enum(defectRootCauseEnum.enumValues).nullable(),
  resolution: z.enum(defectResolutionEnum.enumValues).nullable(),
  foundInReleaseId: z.string().uuid().nullable(),
  foundInReleaseName: z.string().nullable(),
  assigneeId: z.string().uuid().nullable(),
  /**
   * The owning Team. On the wire because the grid's bulk `Copy` re-creates the defect and has to carry
   * it: a copy with no team filed into the Project Backlog, which under the BA ruling of 2026-08-17
   * only a Workspace Admin or Project Admin may reach — so for an Editor `Copy` could not succeed at
   * all, on a surface `quality:view` grants them.
   */
  teamId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  scheduleState: z.string(),
  iterationId: z.string().uuid().nullable(),
  iterationName: z.string().nullable(),
  releaseId: z.string().uuid().nullable(),
  releaseName: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  parentKey: z.string().nullable(),
  parentTitle: z.string().nullable(),
  isBlocked: z.boolean(),
  defectState: z.enum(['submitted', 'open', 'fixed', 'closed', 'closed_declined']).nullable(),
  fixedInBuild: z.string().max(255).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const DefectListResponseSchema = z.object({
  metrics: DefectMetricsSchema,
  data: z.array(DefectRowSchema),
  /**
   * Defects matching the filters across ALL pages.
   *
   * The grid pages at a server-side window; without this the client cannot distinguish a full
   * page from the last one, which is how the list silently showed the first 50 and read as
   * complete. `metrics` is deliberately computed over every defect, not the page, so the two
   * numbers answer different questions and must not be conflated.
   */
  total: z.number().int(),
});

export class DefectListResponseDto extends createZodDto(DefectListResponseSchema) {}
