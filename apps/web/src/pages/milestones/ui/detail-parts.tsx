import { useNavigate } from '@tanstack/react-router'

import { useMilestoneArtifacts } from '@/features/milestones/api'
import { ArtifactsTabView } from '@/entities/work-item/ui/artifacts-tab'
import { useArtifactPagination } from '@/entities/work-item/ui/use-artifact-pagination'

// ── Artifacts tab ──────────────────────────────────────────────────────────────

export function ArtifactsTab({ milestoneId }: { milestoneId: string }) {
  const navigate = useNavigate()
  const pagination = useArtifactPagination()

  const { data, isLoading } = useMilestoneArtifacts(milestoneId, {
    pageSize: pagination.pageSize,
    search: pagination.search || undefined,
  })

  return (
    <ArtifactsTabView
      items={data?.data ?? []}
      isLoading={isLoading}
      pageInfo={data?.pageInfo}
      entityNoun="milestone"
      pagination={pagination}
      onOpenItem={(item) => navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })}
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
