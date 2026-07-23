import { useNavigate } from '@tanstack/react-router'

import { useReleaseArtifacts } from '@/features/releases/api'
import { ArtifactsTabView } from '@/entities/work-item/ui/artifacts-tab'
import { useArtifactPagination } from '@/entities/work-item/ui/use-artifact-pagination'

export function ReleaseArtifactsTab({ releaseId }: { releaseId: string }) {
  const navigate = useNavigate()
  const pagination = useArtifactPagination()

  const { data, isLoading } = useReleaseArtifacts(releaseId, {
    pageSize: pagination.pageSize,
    search: pagination.search || undefined,
  })

  return (
    <ArtifactsTabView
      items={data?.data ?? []}
      isLoading={isLoading}
      pageInfo={data?.pageInfo}
      entityNoun="release"
      pagination={pagination}
      onOpenItem={(item) => navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })}
    />
  )
}
