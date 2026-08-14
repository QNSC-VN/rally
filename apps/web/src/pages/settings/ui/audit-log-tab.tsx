import { useMemo, useState } from 'react'
import { SettingsTabHeader } from './settings-tab-header'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import { apiClient } from '@/shared/api/http-client'
import type { components } from '@/shared/api/generated/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { useWorkspaceTeams } from '@/features/teams/api'
import { describeAuditEvent, type AuditNameResolver } from '@/entities/audit/model/describe-audit'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { SelectableTable, useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { formatWith } from '@/shared/lib/utils'
import { useSystemRoles } from '../model/use-system-roles'
import { SearchableSelect } from '@/shared/ui/searchable-select'

const AUDIT_DEFAULT_PAGE_SIZE = 50

// Audit needs a precise "who did what, exactly when" timestamp, so — unlike the
// app-wide short `formatDateTime` — it includes the weekday and seconds, e.g.
// "Fri, Jul 31, 2026, 2:30:45 PM". Uses the `formatWith` escape hatch so it
// still resolves the user→workspace locale + timezone.
const AUDIT_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
}

type AuditRow = components['schemas']['AuditLogResponseDto']
type AuditColKey = 'time' | 'actor' | 'detail'

// Per-render context: the id→name resolver `describeAuditEvent` needs, plus the
// resolved "System" fallback for actor-less (system) events.
interface AuditCtx {
  resolver: AuditNameResolver
  systemLabel: string
}

// Match the Users / Teams row look, but READ-ONLY: no cursor, no click, no gutter.
const ROW_CLASS =
  'group flex min-h-[34px] items-center gap-2 border-b border-border-subtle bg-card px-3 text-ui-md transition-colors duration-100 hover:bg-primary-lighter'

export function AuditLogTab() {
  const { t } = useTranslation('settings')
  const [pageSize, setPageSize] = useState(AUDIT_DEFAULT_PAGE_SIZE)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  /**
   * ACTOR, filtered server-side. §"Search supports Actor name and Time text" asks for exactly this,
   * and `GET /v1/audit-logs` has taken an `actorId` all along — it was simply never sent, so the only
   * way to find one person's actions was to type their name into a box that searched the 50 rows
   * already on screen. On a log of any size that reads as "this user did nothing".
   *
   * A select rather than free text because the API takes one id: a name fragment matching two people
   * cannot be expressed as `actorId`, and silently picking the first match would be worse than not
   * offering it. The member list is already loaded for the Detail column's name resolution.
   */
  const [actorId, setActorId] = useState('')

  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const { data: teams = [] } = useWorkspaceTeams(workspaceId)
  const { data: roles = [] } = useSystemRoles()

  // Server offset/limit pagination — logs are large, so the API is the source of
  // truth for the page window (never client-sliced).
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', offset, pageSize, from, to, actorId],
    queryFn: async () => {
      const query: {
        limit: number
        offset: number
        from?: string
        to?: string
        actorId?: string
      } = {
        limit: pageSize,
        offset,
      }
      if (from) query.from = `${from}T00:00:00`
      if (to) query.to = `${to}T23:59:59`
      if (actorId) query.actorId = actorId
      const res = await apiClient.GET('/v1/audit-logs', { params: { query } })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const rows = data?.data ?? []
  const hasNextPage = data?.pageInfo?.hasNextPage ?? false

  const resolver = useMemo<AuditNameResolver>(() => {
    const userNames = new Map(members.map((m) => [m.userId, m.displayName || m.email]))
    const teamNames = new Map(teams.map((team) => [team.id, team.name]))
    const roleNames = new Map(roles.map((r) => [r.id, r.name]))
    return {
      user: (id) => userNames.get(id),
      team: (id) => teamNames.get(id),
      role: (id) => roleNames.get(id),
    }
  }, [members, teams, roles])

  /**
   * Only members are offerable, and that is a real limit worth naming: an audit row's actor may be a
   * user who has since been removed from the workspace, and such a row cannot be selected here. It is
   * still reachable — clear the filter and page to it — and the alternative (a distinct-actor endpoint)
   * is a bigger change than this finding.
   */
  const actorOptions = useMemo(
    () => [
      { value: '', label: t('audit.allActors') },
      ...members.map((m) => ({
        value: m.userId,
        label: m.displayName || m.email || m.userId,
      })),
    ],
    [members, t],
  )

  const systemLabel = t('audit.system')
  const cellCtx = useMemo<AuditCtx>(() => ({ resolver, systemLabel }), [resolver, systemLabel])

  /**
   * Free text still refines the CURRENT server page only, and now says so in its own placeholder
   * (`audit.searchPlaceholderPage`).
   *
   * Kept rather than removed because it is the only way to search the Detail sentence, which is
   * assembled client-side from `action` + `changes` + resolved names and therefore cannot be a
   * server predicate at all. The part the spec names — Actor — moved to the server filter above,
   * where it works across the whole log instead of one window.
   */
  const q = search.trim().toLowerCase()
  const actorLabel = (a: AuditRow): string => a.actorName ?? a.actorEmail ?? systemLabel
  const filtered = q
    ? rows.filter(
        (a) =>
          actorLabel(a).toLowerCase().includes(q) ||
          describeAuditEvent(a, resolver).toLowerCase().includes(q),
      )
    : rows

  // Shared table engine (resize / reorder / Show-Fields). No sortCol on any
  // column and no `sort` passed: server pagination means click-sort would only
  // reorder the visible page, which is misleading — so the header stays static.
  const columns = useMemo<ColumnSpec<AuditRow, AuditCtx, AuditColKey>[]>(
    () => [
      {
        key: 'time',
        label: t('audit.colTime'),
        defaultWidth: 264,
        minWidth: 210,
        locked: true,
        cellClassName: 'flex items-center',
        cell: (r) => (
          <span className="truncate text-ui-md text-foreground-subtle">
            {formatWith(r.occurredAt, AUDIT_TIME_FORMAT)}
          </span>
        ),
      },
      {
        key: 'actor',
        label: t('audit.colActor'),
        defaultWidth: 200,
        minWidth: 140,
        cellClassName: 'flex min-w-0 items-center',
        cell: (r, ctx) => (
          <span
            className="text-ui-md break-words whitespace-normal text-foreground"
            title={r.actorEmail ?? r.actorId ?? undefined}
          >
            {r.actorName ?? r.actorEmail ?? ctx.systemLabel}
          </span>
        ),
      },
      {
        key: 'detail',
        label: t('audit.colDetail'),
        defaultWidth: 420,
        minWidth: 220,
        grow: true,
        cellClassName: 'flex min-w-0 items-center',
        cell: (r, ctx) => (
          <span
            className="text-ui-md break-words whitespace-normal text-foreground"
            title={`${r.action} · ${r.resourceType} · ${r.resourceId}`}
          >
            {describeAuditEvent(r, ctx.resolver)}
          </span>
        ),
      },
    ],
    [t],
  )

  const table = useDataTable<AuditRow, AuditCtx, AuditColKey>(columns, {
    storageKey: STORAGE_KEYS.SETTINGS_AUDIT_COLUMNS,
  })

  const activeFilterCount = (from ? 1 : 0) + (to ? 1 : 0) + (actorId ? 1 : 0)

  if (!workspaceId) {
    return <p className="text-ui-lg text-foreground-subtle">{t('members.noWorkspace')}</p>
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-foreground-subtle">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-ui-lg">{t('audit.loading')}</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SettingsTabHeader title={t('nav.audit')} description={t('tabDescriptions.audit')} />

      {/* ── Toolbar — search · date range filters · Show Fields ── */}
      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('audit.searchPlaceholderPage'),
          ariaLabel: t('audit.searchPlaceholderPage'),
          width: 256,
        }}
        activeFilterCount={activeFilterCount}
        defaultFiltersOpen={!!(from || to || actorId)}
        filters={
          <>
            <SearchableSelect
              variant="field"
              value={actorId}
              ariaLabel={t('audit.actorFilter')}
              placeholder={t('audit.allActors')}
              options={actorOptions}
              onChange={(v) => {
                setActorId(v)
                setOffset(0)
              }}
            />
            <Input
              type="date"
              value={from}
              max={to || undefined}
              aria-label={t('audit.fromDate')}
              className="w-40"
              onChange={(e) => {
                setFrom(e.target.value)
                setOffset(0)
              }}
            />
            <Input
              type="date"
              value={to}
              min={from || undefined}
              aria-label={t('audit.toDate')}
              className="w-40"
              onChange={(e) => {
                setTo(e.target.value)
                setOffset(0)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom('')
                setTo('')
                setActorId('')
                setOffset(0)
              }}
            >
              {t('audit.clear')}
            </Button>
          </>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* ── Table — read-only (no selection gutter / bulk bar) ── */}
      <SelectableTable
        rows={filtered}
        selectable={false}
        headerProps={table.headerProps}
        padClassName="gap-2 px-3"
        error={
          isError ? (
            <div className="flex flex-1 items-center justify-center px-3 py-10 text-ui-sm text-destructive">
              {t('audit.loadError')}
            </div>
          ) : undefined
        }
        empty={
          filtered.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-ui-sm text-foreground-subtle">
              {t('audit.empty')}
            </div>
          ) : undefined
        }
        footer={
          rows.length > 0 ? (
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
          ) : undefined
        }
        renderRow={(r) => (
          <div key={r.id} className={ROW_CLASS} style={{ minWidth: 'max-content' }}>
            {table.renderCells(r, cellCtx)}
          </div>
        )}
      />
    </div>
  )
}
