import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { scmProviderEnum } from '../../../../../../../db/schema/enums';

export const CreateScmRepositorySchema = z.object({
  provider: z.enum(scmProviderEnum.enumValues),
  /** owner/name, e.g. "DT-SFI/dt". */
  fullName: z.string().trim().min(1).max(255),
  baseUrl: z.string().url().max(512).nullable().optional(),
});
export class CreateScmRepositoryDto extends createZodDto(CreateScmRepositorySchema) {}

export const ConnectScmInstallationSchema = z.object({
  installationId: z.string().trim().min(1).max(64),
});
export class ConnectScmInstallationDto extends createZodDto(ConnectScmInstallationSchema) {}
