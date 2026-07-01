/**
 * Result<T, E> — typed success/failure monad.
 * Domain functions return Result; they never throw for control flow.
 * Map errors at the application boundary (exception filter).
 */

type Ok<T> = { readonly ok: true; readonly value: T };
type Err<E> = { readonly ok: false; readonly error: E };

export type Result<T, E = Error> = Ok<T> | Err<E>;

export const Result = {
  ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
  },

  fail<E>(error: E): Result<never, E> {
    return { ok: false, error };
  },

  isOk<T, E>(result: Result<T, E>): result is Ok<T> {
    return result.ok === true;
  },

  isFail<T, E>(result: Result<T, E>): result is Err<E> {
    return result.ok === false;
  },

  map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    if (result.ok) return Result.ok(fn(result.value));
    return result;
  },

  mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    if (!result.ok) return Result.fail(fn(result.error));
    return result as Result<T, F>;
  },

  flatMap<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
    if (result.ok) return fn(result.value);
    return result;
  },

  /** Unwrap or throw — use only at application/interface boundaries */
  unwrapOrThrow<T, E>(result: Result<T, E>): T {
    if (result.ok) return result.value;
    if (result.error instanceof Error) throw result.error;
    throw new Error(String(result.error));
  },

  /** Unwrap with a fallback value */
  unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
    return result.ok ? result.value : fallback;
  },
} as const;
