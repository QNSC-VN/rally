import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { useReleaseArtifacts } from '@/features/releases/api'
import { InlineSelect } from '@/shared/ui/native-select'
import { SearchInput } from '@/shared/ui/search-input'
import { ArtifactTable } from '@/entities/work-item/ui/artifact-table'

export function ReleaseArtifactsTab({ releaseId }: { releaseId: string }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const currentPage = cursorHistory.length + 1

  const { data, isLoading } = useReleaseArtifacts(releaseId, {
    pageSize,
    search: search || undefined,
  })

  const items = useMemo(() => data?.data ?? [], [data])
  const pageInfo = data?.pageInfo

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
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-card px-4 py-2">
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
        <span className="text-ui-sm text-foreground-subtle">
          {pageInfo?.total != null ? `${pageInfo.total} items` : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-card">
        <ArtifactTable
          items={items}
          isLoading={isLoading}
          search={search}
          entityNoun="release"
          startIndex={cursorHistory.length * pageSize}
          onOpenItem={(item) =>
            navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
          }
        />
      </div>

      {/* Pagination footer */}
      {items.length > 0 && (
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-border-subtle bg-card px-3">
          <div className="flex items-center gap-2 text-ui-sm text-muted-foreground">
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
            <span className="text-foreground-subtle">
              {pageInfo
                ? `${(currentPage - 1) * pageSize + 1}–${(currentPage - 1) * pageSize + items.length}${pageInfo.total ? ` of ${pageInfo.total}` : ''}`
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-ui-sm text-muted-foreground tabular-nums">
              Page {currentPage}
            </span>
            <button
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={onPrevPage}
              className="rounded border border-border-strong p-1.5 text-muted-foreground disabled:opacity-35"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={!pageInfo?.hasNextPage}
              onClick={onNextPage}
              className="rounded border border-border-strong p-1.5 text-muted-foreground disabled:opacity-35"
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
