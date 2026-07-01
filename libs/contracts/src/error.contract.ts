import { z } from 'zod';

export const ErrorDetailSchema = z.object({
  path: z.array(z.string()).optional(),
  message: z.string(),
  code: z.string().optional(),
});

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(ErrorDetailSchema).default([]),
    correlationId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
