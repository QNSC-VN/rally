import { useEffect, useState } from 'react'

/** Cursor page metadata returned by the `use*Artifacts` query hooks. */
export interface ArtifactPageInfo {
  hasNextPage: boolean
  nextCursor: string | null
  total?: number
}

/**
 * Cursor-pagination + search state for a linked-artifacts tab (shared by the
 * release- and milestone-detail Artifacts tabs). `cursorHistory` drives the
 * row-offset display and Prev/Next; changing search or page size resets to the
 * first page (deferred a tick, matching the prior behaviour).
 */
export function useArtifactPagination() {
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])

  const currentPage = cursorHistory.length + 1
  const startIndex = cursorHistory.length * pageSize

  useEffect(() => {
    const id = setTimeout(() => setCursorHistory([]), 0)
    return () => clearTimeout(id)
  }, [search, pageSize])

  return {
    search,
    setSearch,
    pageSize,
    setPageSize,
    currentPage,
    startIndex,
    prev: () => setCursorHistory((h) => h.slice(0, -1)),
    next: (nextCursor: string) => setCursorHistory((h) => [...h, nextCursor]),
  }
}

export type ArtifactPagination = ReturnType<typeof useArtifactPagination>
