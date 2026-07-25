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
export type ScmInstallation = components['schemas']['ScmInstallationResponseDto']

export const scmRepositoryKeys = {
  all: ['scm-repositories'] as const,
  list: (workspaceId: string) => ['scm-repositories', workspaceId] as const,
}

export const scmInstallationKeys = {
  all: ['scm-installations'] as const,
  list: (workspaceId: string) => ['scm-installations', workspaceId] as const,
  available: (workspaceId: string) => ['scm-installations', workspaceId, 'available'] as const,
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

export function useSyncScmRepository(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error, response } = await apiClient.POST('/v1/scm/repositories/{id}/sync', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
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

// ── GitHub App installations (org-level auto-discovery) ───────────────────────

/** Installations already bound to this workspace (dashboard header). */
export function useScmInstallations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: scmInstallationKeys.list(workspaceId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/scm/installations')
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data ?? []) as ScmInstallation[]
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })
}

/** Installations the App can see, flagged with which are already connected (Connect picker). */
export function useScmInstallationsAvailable(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: scmInstallationKeys.available(workspaceId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/scm/installations/available')
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data ?? []) as ScmInstallation[]
    },
    enabled: !!workspaceId && enabled,
    staleTime: 15_000,
  })
}

export function useConnectGitHub(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (installationId: string) => {
      const { data, error, response } = await apiClient.POST('/v1/scm/installations', {
        body: { installationId },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    meta: {
      invalidateKeys: [
        scmInstallationKeys.list(workspaceId ?? ''),
        scmInstallationKeys.available(workspaceId ?? ''),
        scmRepositoryKeys.list(workspaceId ?? ''),
      ],
    },
  })
}

export function useDisconnectGitHub(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (installationId: string) => {
      const { error, response } = await apiClient.DELETE('/v1/scm/installations/{installationId}', {
        params: { path: { installationId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: {
      invalidateKeys: [
        scmInstallationKeys.list(workspaceId ?? ''),
        scmInstallationKeys.available(workspaceId ?? ''),
        scmRepositoryKeys.list(workspaceId ?? ''),
      ],
    },
  })
}
