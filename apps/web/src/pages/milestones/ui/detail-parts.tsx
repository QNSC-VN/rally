import { type ComponentType } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { useMilestoneArtifacts } from '@/features/milestones/api'
import { ArtifactsTabView } from '@/entities/work-item/ui/artifacts-tab'
import { useArtifactPagination } from '@/entities/work-item/ui/use-artifact-pagination'

export function RelationButton({
  icon: Icon,
  label,
  count,
  onClick,
  canManage,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  label: string
  count: number
  onClick: () => void
  canManage: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canManage}
      className="flex w-full items-center gap-2 rounded-md border border-border-subtle px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-80"
    >
      <Icon size={14} className="text-foreground-subtle" />
      <span className="flex-1 font-medium">{label}</span>
      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-lighter px-1.5 text-ui-xs font-bold text-primary">
        {count}
      </span>
    </button>
  )
}

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
