import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'

import { apiClient } from '@/shared/api/http-client'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { useWorkspaceTeams } from '@/features/teams/api'
import { describeAuditEvent, type AuditNameResolver } from '@/entities/audit/model/describe-audit'
import { Button } from '@/shared/ui/button'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { SearchInput } from '@/shared/ui/search-input'
import { Spinner } from '@/shared/ui/spinner'
import { useSystemRoles } from '../model/use-system-roles'

const AUDIT_DEFAULT_PAGE_SIZE = 50

/** Full, unambiguous timestamp for an audit entry (audit trails avoid abbreviations). */
function formatAuditTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

const DATE_INPUT_CLS = 'rounded border px-2 py-1.5 text-ui-sm text-foreground focus:outline-none'

export function AuditLogTab() {
  const [pageSize, setPageSize] = useState(AUDIT_DEFAULT_PAGE_SIZE)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const { data: teams = [] } = useWorkspaceTeams(workspaceId)
  const { data: roles = [] } = useSystemRoles()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', offset, pageSize, from, to],
    queryFn: async () => {
      const query: { limit: number; offset: number; from?: string; to?: string } = {
        limit: pageSize,
        offset,
      }
      if (from) query.from = `${from}T00:00:00`
      if (to) query.to = `${to}T23:59:59`
      const res = await apiClient.GET('/v1/audit-logs', { params: { query } })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const rows = data?.data ?? []
  const hasNextPage = data?.pageInfo?.hasNextPage ?? false

  const resolver = useMemo<AuditNameResolver>(() => {
    const userNames = new Map(members.map((m) => [m.userId, m.displayName || m.email]))
    const teamNames = new Map(teams.map((t) => [t.id, t.name]))
    const roleNames = new Map(roles.map((r) => [r.id, r.name]))
    return {
      user: (id) => userNames.get(id),
      team: (id) => teamNames.get(id),
      role: (id) => roleNames.get(id),
    }
  }, [members, teams, roles])

  const actorLabel = (a: (typeof rows)[number]): string => a.actorName ?? a.actorEmail ?? 'System'

  const q = search.trim().toLowerCase()
  const filtered = q
    ? rows.filter(
        (a) =>
          actorLabel(a).toLowerCase().includes(q) ||
          describeAuditEvent(a, resolver).toLowerCase().includes(q),
      )
    : rows

  return (
    <div>
      {/* ── Header: note + filters + search ── */}
      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="text-ui-md text-foreground-subtle">
          Administrative and settings changes for this workspace.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value)
              setOffset(0)
            }}
            aria-label="From date"
            className={DATE_INPUT_CLS}
          />
          <span className="text-ui-sm text-foreground-subtle">–</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value)
              setOffset(0)
            }}
            aria-label="To date"
            className={DATE_INPUT_CLS}
          />
          {(from || to) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom('')
                setTo('')
                setOffset(0)
              }}
            >
              Clear
            </Button>
          )}
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search actor or description…"
            width={256}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded border">
        <div className="flex h-8 items-center gap-2 border-b bg-background px-3">
          {[
            ['w-56', 'Time'],
            ['w-48', 'Actor'],
            ['flex-1', 'Detail'],
          ].map(([c, l]) => (
            <div
              key={l}
              className={`${c} text-ui-2xs font-semibold tracking-wider text-foreground-subtle uppercase`}
            >
              {l}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-foreground-subtle">
            <Spinner size="md" />
            <span className="text-ui-md">Loading audit log…</span>
          </div>
        ) : isError ? (
          <div className="px-3 py-6 text-center text-ui-sm text-destructive">
            Failed to load audit log. Please try again.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-ui-sm text-foreground-subtle">
            No audit events found.
          </div>
        ) : (
          filtered.map((a) => (
            <div
              key={a.id}
              className="flex min-h-10 items-center gap-2 border-b border-border-inner px-3 py-1.5"
            >
              <div className="flex w-56 items-center gap-1 text-ui-xs text-foreground-subtle">
                <Clock size={10} />
                {formatAuditTime(a.occurredAt)}
              </div>
              <div
                className="w-48 truncate text-ui-sm font-medium text-foreground"
                title={a.actorEmail ?? a.actorId ?? undefined}
              >
                {actorLabel(a)}
              </div>
              <div
                className="min-w-0 flex-1 truncate text-ui-sm text-foreground"
                title={`${a.action} · ${a.resourceType} · ${a.resourceId}`}
              >
                {describeAuditEvent(a, resolver)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Pagination ── */}
      {rows.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border">
          <PaginationFooter
            pageSize={pageSize}
            setPageSize={(n) => {
              setPageSize(n)
              setOffset(0)
            }}
            currentPage={Math.floor(offset / pageSize) + 1}
            rangeStart={rows.length === 0 ? 0 : offset + 1}
            rangeEnd={offset + rows.length}
            hasPrevPage={offset > 0}
            hasNextPage={hasNextPage}
            onPrevPage={() => setOffset((o) => Math.max(0, o - pageSize))}
            onNextPage={() => setOffset((o) => o + pageSize)}
          />
        </div>
      )}
    </div>
  )
}
