import { ChevronLeft, ChevronRight } from 'lucide-react'

import { InlineSelect } from '@/shared/ui/native-select'
import { BRAND } from '@/shared/config/brand'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/**
 * Shared table pagination footer used across grid pages (backlog, iteration
 * status, …). Deliberately mechanism-agnostic: callers compute the visible
 * range and page navigation state themselves, so the same footer serves both
 * cursor-based (Prev/Next) and offset-based (Page N of M, total count) grids.
 */
export function PaginationFooter({
  pageSize,
  setPageSize,
  currentPage,
  rangeStart,
  rangeEnd,
  total,
  pageCount,
  hasPrevPage,
  hasNextPage,
  onPrevPage,
  onNextPage,
}: {
  pageSize: number
  setPageSize: (n: number) => void
  currentPage: number
  /** 1-based index of the first row shown on the current page. */
  rangeStart: number
  /** 1-based index of the last row shown on the current page. */
  rangeEnd: number
  /** Grand total across all pages, when known. Enables the "of N" suffix. */
  total?: number
  /** Total number of pages, when known. Enables the "of M" page suffix. */
  pageCount?: number
  hasPrevPage: boolean
  hasNextPage: boolean
  onPrevPage: () => void
  onNextPage: () => void
}) {
  const hasRange = rangeEnd >= rangeStart
  return (
    <div
      className="flex h-10 shrink-0 items-center justify-between bg-white px-3"
      style={{ borderTop: `1px solid ${BRAND.borderSubtle}` }}
    >
      <div className="flex items-center gap-2 text-ui-sm text-muted-foreground">
        <span>Rows per page</span>
        <InlineSelect
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="w-auto"
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </InlineSelect>
        <span className="tabular-nums" style={{ color: BRAND.textMuted }}>
          {hasRange ? `${rangeStart}–${rangeEnd}${total != null ? ` of ${total}` : ''}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-ui-sm text-muted-foreground tabular-nums">
          {`Page ${currentPage}${pageCount != null ? ` of ${pageCount}` : ''}`}
        </span>
        <button
          type="button"
          aria-label="Previous page"
          disabled={!hasPrevPage}
          onClick={onPrevPage}
          className="rounded p-1.5 disabled:opacity-35"
          style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
        >
          <ChevronLeft size={13} />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={!hasNextPage}
          onClick={onNextPage}
          className="rounded p-1.5 disabled:opacity-35"
          style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}
