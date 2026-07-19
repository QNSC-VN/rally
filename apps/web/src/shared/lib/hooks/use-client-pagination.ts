import { useMemo, useState } from 'react'

/**
 * useClientPagination — offset pagination for lists already loaded in full on
 * the client (e.g. workspace members, teams). Returns the current page slice
 * plus a props bag ready to spread straight into {@link PaginationFooter}.
 *
 * `currentPage` is derived (clamped to the live page count) so shrinking the
 * source list — e.g. via a search filter — never strands the view on an empty
 * page, without needing a setState-in-effect reset.
 */
export function useClientPagination<T>(items: T[], initialPageSize = 25) {
  const [pageSize, setPageSizeRaw] = useState(initialPageSize)
  const [page, setPage] = useState(1) // 1-based

  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)

  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize],
  )

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeEnd = Math.min(currentPage * pageSize, total)

  const footerProps = {
    pageSize,
    setPageSize: (n: number) => {
      setPageSizeRaw(n)
      setPage(1)
    },
    currentPage,
    rangeStart,
    rangeEnd,
    total,
    pageCount,
    hasPrevPage: currentPage > 1,
    hasNextPage: currentPage < pageCount,
    onPrevPage: () => setPage((p) => Math.max(1, p - 1)),
    onNextPage: () => setPage((p) => Math.min(pageCount, p + 1)),
  }

  return { pageItems, footerProps, resetPage: () => setPage(1) }
}
