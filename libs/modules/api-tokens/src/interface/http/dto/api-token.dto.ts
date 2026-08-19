import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { MAX_EXPIRY_DAYS } from '../../../domain/api-token';

// ── Mint a token ─────────────────────────────────────────────────────────────

export const CreateApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(100).describe('Human label, shown in the token list'),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_EXPIRY_DAYS)
    .optional()
    .describe(`Lifetime in days. Defaults to 90, capped at ${MAX_EXPIRY_DAYS}.`),
  /**
   * Validated as free-form strings here and against the permission catalogue in the service. The
   * catalogue is the authority and lives outside `libs/`, so encoding it as a zod enum would give the
   * DTO a second copy to drift from — and a rejected scope deserves a message naming the unknown code,
   * which a 422 from an enum does not give.
   */
  scopes: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe(
      'Permission codes this token may use. NARROWING only — the effective set is your own ' +
        'permissions intersected with this list, so a token can never exceed its owner. Omit to ' +
        'inherit your permissions unchanged.',
    ),
});

export class CreateApiTokenDto extends createZodDto(CreateApiTokenSchema) {}

// ── Responses ────────────────────────────────────────────────────────────────

/**
 * Timestamps are `z.string().datetime()`, matching every other response DTO — not `z.date()`.
 *
 * Two reasons, and the second is a hard failure. Over the wire these are ISO strings, so a `Date` was
 * never the contract. And `nestjs-zod` cannot express a `Date` in JSON Schema: the OpenAPI metadata
 * factory throws "Date cannot be represented in JSON Schema" the moment Swagger metadata is generated,
 * which takes down every suite that boots the app through `bootstrapApp` — `csrf-protection.e2e` found
 * it, several files away from anything to do with tokens.
 */
export const ApiTokenResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string().describe('First 12 characters. Identifies the token; cannot reconstruct it.'),
  scopes: z.array(z.string()).nullable(),
  expiresAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  userId: z.string().uuid(),
});

export class ApiTokenResponseDto extends createZodDto(ApiTokenResponseSchema) {}

export const CreatedApiTokenResponseSchema = ApiTokenResponseSchema.extend({
  token: z
    .string()
    .describe(
      'The credential. Shown once and never retrievable again — store it now. A lost token is ' +
        'revoked and replaced, not recovered.',
    ),
});

export class CreatedApiTokenResponseDto extends createZodDto(CreatedApiTokenResponseSchema) {}

/**
 * Serialise a service view for the wire.
 *
 * The service speaks `Date` because the domain does; HTTP speaks ISO strings. One conversion in one
 * place, rather than three controller handlers each doing it slightly differently — and the compiler
 * enforces that it happens at all, which is how the `z.date()` mistake was caught a second time.
 */
export function toApiTokenResponse(view: {
  id: string;
  name: string;
  prefix: string;
  scopes: string[] | null;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  userId: string;
}): ApiTokenResponseDto {
  return {
    id: view.id,
    name: view.name,
    prefix: view.prefix,
    scopes: view.scopes,
    expiresAt: view.expiresAt.toISOString(),
    lastUsedAt: view.lastUsedAt?.toISOString() ?? null,
    revokedAt: view.revokedAt?.toISOString() ?? null,
    createdAt: view.createdAt.toISOString(),
    userId: view.userId,
  };
}
