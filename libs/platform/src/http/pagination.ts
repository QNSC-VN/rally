import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import {
  and,
  or,
  eq,
  gt,
  lt,
  isNull,
  isNotNull,
  type Column,
  type GetColumnData,
  type SQL,
} from 'drizzle-orm';
import { ErrorCodes } from '../errors/error-codes';
import { PreconditionFailedException } from '../errors/exceptions';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ── Cursor internal shape (base64url-encoded opaque token) ───────────────────

const CursorPayloadSchema = z.object({
  v: z.literal(1),
  k: z.array(z.unknown()),
  id: z.string().uuid(),
  d: z.enum(['asc', 'desc']),
});

type CursorPayload = z.infer<typeof CursorPayloadSchema>;

export type { CursorPayload };

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return CursorPayloadSchema.parse(raw);
  } catch {
    throw new PreconditionFailedException(ErrorCodes.INVALID_CURSOR, 'Invalid or tampered cursor');
  }
}

// ── Request schema ────────────────────────────────────────────────────────────

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
  sort: z.string().optional(),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

// ── Response types ────────────────────────────────────────────────────────────

export interface PageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
  limit: number;
  /**
   * Total number of rows matching the query's filters, ignoring the page
   * cursor/limit. Optional: only endpoints that display a total count compute
   * it (an extra COUNT query), so keyset lists that don't need it stay cheap.
   */
  total?: number;
}

export interface PagedResult<T> {
  data: T[];
  pageInfo: PageInfo;
}

/**
 * Build paged result.
 * Fetches limit + 1 items; presence of the extra item signals hasNextPage.
 */
export function buildPageResult<T extends { id: string }>(
  /** items fetched with limit + 1 */
  rawItems: T[],
  limit: number,
  buildCursorKey: (item: T) => unknown[],
  direction: 'asc' | 'desc' = 'asc',
  /** Total rows matching the filters (before cursor/limit); omit if not needed. */
  total?: number,
): PagedResult<T> {
  const hasNextPage = rawItems.length > limit;
  const data = hasNextPage ? rawItems.slice(0, limit) : rawItems;
  const last = data.at(-1);

  const nextCursor =
    hasNextPage && last
      ? encodeCursor({ v: 1, k: buildCursorKey(last), id: last.id, d: direction })
      : null;

  return {
    data,
    pageInfo: { nextCursor, hasNextPage, limit, ...(total !== undefined ? { total } : {}) },
  };
}

/**
 * Build the WHERE predicate for keyset ("seek") pagination that is correct for
 * ANY sortable column — including non-unique, nullable, and enum columns —
 * using a unique, non-null tie-breaker column (typically the primary key).
 *
 * The caller MUST order the query the same way the cursor was produced:
 *   `ORDER BY <sortCol> <direction>, <tieBreakCol> ASC`
 * and build the cursor with the same `direction`, `k[0]` = the sort-column
 * value of the last row, and `id` = its tie-breaker value — which is exactly
 * what {@link buildPageResult} does when given `(w) => [sortValue(w)]` and the
 * matching direction. Keeping ORDER BY and the cursor key on the same column is
 * what the previous rank-only keyset failed to do for non-rank sorts.
 *
 * Null ordering follows the Postgres (and Drizzle `asc`/`desc`) defaults:
 * ASC → NULLS LAST, DESC → NULLS FIRST.
 */
export function keysetCondition<TSort extends Column>(
  sortCol: TSort,
  tieBreakCol: Column,
  cursor: CursorPayload,
): SQL {
  const value = cursor.k[0] as GetColumnData<TSort, 'raw'> | null | undefined;
  const afterTie = gt(tieBreakCol, cursor.id);
  if (cursor.d === 'asc') {
    // NULLS LAST: null rows sort after every non-null row, so once the cursor is
    // on a null row only later null rows remain; otherwise all null rows follow.
    return value === null || value === undefined
      ? and(isNull(sortCol), afterTie)!
      : or(gt(sortCol, value), and(eq(sortCol, value), afterTie), isNull(sortCol))!;
  }
  // DESC → NULLS FIRST: null rows sort before every non-null row.
  return value === null || value === undefined
    ? or(and(isNull(sortCol), afterTie), isNotNull(sortCol))!
    : or(lt(sortCol, value), and(eq(sortCol, value), afterTie))!;
}

/**
 * Decode a raw PageQuery into { limit, cursor } for use in repository queries.
 * Returns null cursor when the query has no cursor (first page).
 *
 * @example
 * const { limit, cursor } = buildPageArgs(query);
 * const rows = await repo.findMany({
 *   where: cursor ? sql`(created_at, id) < (${cursor.k[0]}, ${cursor.id})` : undefined,
 *   limit: limit + 1,
 * });
 * return buildPageResult(rows, limit, (r) => [r.createdAt]);
 */
export function buildPageArgs(query: PageQuery): {
  limit: number;
  cursor: CursorPayload | null;
} {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  return { limit, cursor };
}

/**
 * Parse the shared `sort` query param (`"<field>[:asc|:desc]"`) into a
 * `{ sortBy, sortDirection }` pair, validated against a whitelist of allowed
 * fields. Returns `null` when unset or the field is not allowed, so callers
 * fall back to their default ordering. Single source of truth for `sort`
 * string handling across every list endpoint using {@link PageQuerySchema}.
 */
export function parseSort<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
): { sortBy: F; sortDirection: 'asc' | 'desc' } | null {
  if (!sort) return null;
  const [field, dir] = sort.split(':');
  if (!allowed.includes(field as F)) return null;
  return { sortBy: field as F, sortDirection: dir === 'desc' ? 'desc' : 'asc' };
}

// ── DTO class for NestJS controllers ─────────────────────────────────────────

export class PageQueryDto extends createZodDto(PageQuerySchema) {}

// ── Swagger helper for paginated responses ────────────────────────────────────
//
// Usage in controllers:
//   @ApiPagedResponse(WorkItemResponseDto)
//   async listWorkItems(...): Promise<PagedResult<WorkItemResponseDto>> { ... }

export const ApiPagedResponse = <T>(model: Type<T>) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description: 'Paginated list',
      schema: {
        properties: {
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          pageInfo: {
            type: 'object',
            required: ['nextCursor', 'hasNextPage', 'limit'],
            properties: {
              nextCursor: {
                type: 'string',
                nullable: true,
                description: 'Opaque cursor token for the next page',
              },
              hasNextPage: { type: 'boolean' },
              limit: { type: 'number', description: 'Number of items returned per page' },
              total: {
                type: 'number',
                description:
                  'Total rows matching the filters (ignoring cursor/limit); present only on endpoints that expose a count',
              },
            },
          },
        },
      },
    }),
  );
