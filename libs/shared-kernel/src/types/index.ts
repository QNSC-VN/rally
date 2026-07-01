/**
 * Shared primitive types — no domain knowledge, no framework deps.
 */

/** ISO-8601 UTC datetime string */
export type IsoDateString = string & { readonly _brand: 'IsoDateString' };

/** Positive integer (story points, etc.) */
export type PositiveInt = number & { readonly _brand: 'PositiveInt' };

/** Pagination direction */
export type SortDirection = 'asc' | 'desc';

/** Generic key-value metadata map */
export type Metadata = Record<string, string | number | boolean | null>;

/** Nullable utility */
export type Nullable<T> = T | null;

/** Make all properties deeply readonly */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
