/**
 * Linked-artifacts tab — the shared "Artifacts" detail-tab used by the release-
 * and milestone-detail pages. Both had a byte-for-byte copy of this (search
 * toolbar + {@link ArtifactTable} + a hand-rolled pagination footer that
 * re-implemented {@link PaginationFooter}); this is the single source of truth.
 *
 * The pagination + search state lives in {@link useArtifactPagination} (its own
 * file, so this module only exports a component). An entity page calls its OWN
 * artifacts query with the pagination's `search`/`pageSize`, then hands the
 * result to this view:
 *
 *   const pg = useArtifactPagination()
 *   const { data, isLoading } = useReleaseArtifacts(id, { pageSize: pg.pageSize, search: pg.search || undefined })
 *   return <ArtifactsTabView items={data?.data ?? []} isLoading={isLoading}
 *            pageInfo={data?.pageInfo} entityNoun="release" pagination={pg}
 *            onOpenItem={(i) => navigate(...)} />
 */
import { ArtifactTable, type ArtifactTableItem } from '@/entities/work-item/ui/artifact-table'
import type {
  ArtifactPageInfo,
  ArtifactPagination,
} from '@/entities/work-item/ui/use-artifact-pagination'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { SearchInput } from '@/shared/ui/search-input'

export function ArtifactsTabView({
  items,
  isLoading,
  pageInfo,
  entityNoun,
  pagination,
  onOpenItem,
}: {
  items: ArtifactTableItem[]
  isLoading: boolean
  pageInfo?: ArtifactPageInfo
  /** Noun used in the empty state, e.g. "release" or "milestone". */
  entityNoun: string
  pagination: ArtifactPagination
  onOpenItem: (item: ArtifactTableItem) => void
}) {
  const { search, setSearch, pageSize, setPageSize, currentPage, startIndex, prev, next } =
    pagination

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-card px-4 py-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search artifacts…"
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
          entityNoun={entityNoun}
          startIndex={startIndex}
          onOpenItem={onOpenItem}
        />
      </div>

      {/* Pagination — shared footer (was hand-rolled per entity) */}
      {items.length > 0 && (
        <PaginationFooter
          pageSize={pageSize}
          setPageSize={setPageSize}
          currentPage={currentPage}
          rangeStart={startIndex + 1}
          rangeEnd={startIndex + items.length}
          total={pageInfo?.total}
          hasPrevPage={currentPage > 1}
          hasNextPage={!!pageInfo?.hasNextPage}
          onPrevPage={prev}
          onNextPage={() => {
            if (pageInfo?.nextCursor) next(pageInfo.nextCursor)
          }}
        />
      )}
    </div>
  )
}
