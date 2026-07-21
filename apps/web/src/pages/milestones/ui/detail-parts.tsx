import { useEffect, useMemo, useState, type CSSProperties, type ComponentType } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { useMilestoneArtifacts } from '@/features/milestones/api'
import { InlineSelect } from '@/shared/ui/native-select'
import { SearchInput } from '@/shared/ui/search-input'
import { ArtifactTable } from '@/entities/work-item/ui/artifact-table'

export function RelationButton({
  icon: Icon,
  label,
  count,
  onClick,
  canManage,
}: {
  icon: ComponentType<{ size?: number; style?: CSSProperties }>
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
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-80"
      style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
    >
      <Icon size={14} style={{ color: BRAND.textMuted }} />
      <span className="flex-1 font-medium">{label}</span>
      <span
        className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
        style={{ backgroundColor: BRAND.primaryLighter, color: BRAND.primary }}
      >
        {count}
      </span>
    </button>
  )
}

// ── Artifacts tab ──────────────────────────────────────────────────────────────

export function ArtifactsTab({ milestoneId }: { milestoneId: string }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const currentPage = cursorHistory.length + 1

  const { data, isLoading } = useMilestoneArtifacts(milestoneId, {
    pageSize,
    search: search || undefined,
  })

  const items = useMemo(() => data?.data ?? [], [data])
  const pageInfo = data?.pageInfo

  // Reset pagination on search / pageSize change
  useEffect(() => {
    const id = setTimeout(() => {
      setCursor(undefined)
      setCursorHistory([])
    }, 0)
    return () => clearTimeout(id)
  }, [search, pageSize])

  function onPrevPage() {
    const prev = cursorHistory[cursorHistory.length - 2]
    setCursorHistory((h) => h.slice(0, -1))
    setCursor(prev)
  }

  function onNextPage() {
    if (!pageInfo?.hasNextPage || !pageInfo.nextCursor) return
    setCursorHistory((h) => [...h, cursor ?? ''])
    setCursor(pageInfo.nextCursor)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search toolbar */}
      <div
        className="flex shrink-0 items-center gap-3 px-4 py-2"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}`, backgroundColor: BRAND.surface }}
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search artifacts..."
          ariaLabel="Search artifacts"
          width={220}
          iconSize={13}
          className="rounded-md py-1.5 pl-8 text-xs"
        />
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
          {pageInfo?.total != null ? `${pageInfo.total} items` : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: BRAND.surface }}>
        <ArtifactTable
          items={items}
          isLoading={isLoading}
          search={search}
          entityNoun="milestone"
          startIndex={cursorHistory.length * pageSize}
          onOpenItem={(item) =>
            navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
          }
        />
      </div>

      {/* Pagination footer */}
      {items.length > 0 && (
        <div
          className="flex h-9 shrink-0 items-center justify-between bg-white px-3"
          style={{ borderTop: `1px solid ${BRAND.borderSubtle}` }}
        >
          <div
            className="flex items-center gap-2 text-[11px]"
            style={{ color: BRAND.textSecondary }}
          >
            <span>Rows per page</span>
            <InlineSelect
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-auto"
            >
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </InlineSelect>
            <span style={{ color: BRAND.textMuted }}>
              {pageInfo
                ? `${(currentPage - 1) * pageSize + 1}–${(currentPage - 1) * pageSize + items.length}${pageInfo.total ? ` of ${pageInfo.total}` : ''}`
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
              Page {currentPage}
            </span>
            <button
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={onPrevPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={!pageInfo?.hasNextPage}
              onClick={onNextPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
