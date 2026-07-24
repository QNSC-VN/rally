/**
 * SCM integrations API — repository → project mappings (Settings ▸ Integrations).
 * These control which project's work-item keys a webhook's repo may reference.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

export type ScmRepository = components['schemas']['ScmRepositoryResponseDto']
export type ScmProvider = ScmRepository['provider']

export const scmRepositoryKeys = {
  all: ['scm-repositories'] as const,
  list: (workspaceId: string) => ['scm-repositories', workspaceId] as const,
}

export function useScmRepositories(workspaceId: string | undefined) {
  return useQuery({
    queryKey: scmRepositoryKeys.list(workspaceId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/scm/repositories')
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data ?? []) as ScmRepository[]
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })
}

export interface CreateScmRepositoryInput {
  provider: ScmProvider
  fullName: string
  baseUrl?: string | null
  projectIds: string[]
}

export function useCreateScmRepository(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (input: CreateScmRepositoryInput) => {
      const { data, error, response } = await apiClient.POST('/v1/scm/repositories', {
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ScmRepository
    },
    meta: { invalidateKeys: [scmRepositoryKeys.list(workspaceId ?? '')] },
  })
}

export function useDeleteScmRepository(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await apiClient.DELETE('/v1/scm/repositories/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidateKeys: [scmRepositoryKeys.list(workspaceId ?? '')] },
  })
}
