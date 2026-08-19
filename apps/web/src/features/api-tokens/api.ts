/**
 * API token hooks — TanStack Query wrappers around the typed openapi-fetch client.
 *
 * Two audiences, two routes, and only the personal one is wired here: `/v1/me/api-tokens` is what a
 * user manages for themselves. The administrative pair (`/v1/api-tokens`) is gated on
 * `api_token:manage_all` and belongs to a Workspace surface, so it stays out until that surface
 * exists rather than being half-built behind a permission the FE catalogue does not yet mirror.
 *
 * The one thing to know before reading further: **minting returns the credential exactly once**. The
 * database stores a SHA-256 hash, so no endpoint can return it again — `useCreateApiToken` is the
 * only place in the app that ever holds a usable token, and the surface it feeds has to treat that
 * as its central constraint rather than as a detail.
 */
import { useMutation, useQuery } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

/** A token as the list returns it: identity and lifecycle, never the credential. */
export type ApiToken = components['schemas']['ApiTokenResponseDto']

/** The mint response — the ONLY shape carrying `token`, and only in the reply that created it. */
export type CreatedApiToken = components['schemas']['CreatedApiTokenResponseDto']

export type CreateApiTokenInput = components['schemas']['CreateApiTokenDto']

/**
 * Lifetime bounds, mirrored from the backend so the form cannot offer a value the API refuses.
 *
 * Duplicated deliberately and pinned by a test: the alternative is a picker that lets someone ask
 * for two years, waits for a round trip, and reports a validation error for a choice the UI
 * suggested.
 */
export const TOKEN_EXPIRY_DEFAULT_DAYS = 90
export const TOKEN_EXPIRY_MAX_DAYS = 365

/** The user's own tokens, newest first as the API returns them. */
export function useMyApiTokens() {
  return useQuery({
    // Under `['api-tokens']` so the `api-token` invalidation tag, which matches by key prefix,
    // refreshes this list after a mint or a revoke without naming it.
    queryKey: ['api-tokens', 'me'],
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/me/api-tokens')
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as ApiToken[]) ?? []
    },
    staleTime: 30_000,
  })
}

/**
 * Mint a token. The resolved value carries the plaintext credential.
 *
 * Returned to the caller rather than cached: putting it in the query cache would leave a live
 * credential in memory for every later reader of that key, and in a devtools panel, for as long as
 * the cache entry survives. The one component that needs it holds it in state and drops it on close.
 */
export function useCreateApiToken() {
  return useMutation({
    mutationFn: async (body: CreateApiTokenInput) => {
      const { data, error, response } = await apiClient.POST('/v1/me/api-tokens', { body })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CreatedApiToken
    },
    meta: { invalidates: ['api-token'] },
  })
}

/**
 * Revoke a token by id. Irreversible, and immediate: the resolver reads `revoked_at` on every
 * request, so a revoked token stops working on its next call rather than at its next expiry.
 */
export function useRevokeApiToken() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await apiClient.DELETE('/v1/me/api-tokens/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['api-token'] },
  })
}
