/**
 * Connections tab — SCM Pull Requests + Changesets linked to a work item
 * (Rally's "Connections" screen), with two sub-tabs.
 *
 * Both sub-tabs reuse the SAME shared table engine as the work-item / read-list
 * grids — `useDataTable` (column resize / reorder / Show-Fields) rendered through
 * `ListPageScaffold` (PageToolbar search + Show Filters + Show Fields, client
 * pagination + shared PaginationFooter). No bespoke table/footer. Lists are
 * small per work item, so we fetch one generous page and filter client-side.
 */
import { useMemo, useState } from 'react'
import { GitCommitHorizontal, GitPullRequest } from 'lucide-react'

import {
  useWorkItemConnections,
  useWorkItemChangesets,
  type ScmConnection,
  type ScmChangeset,
} from '@/features/work-items/api'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { ListPageScaffold } from '@/shared/ui/list-page/list-page-scaffold'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { InlineSelect } from '@/shared/ui/native-select'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'

// ── Shared cell helpers ───────────────────────────────────────────────────────

type ScmCtx = Record<string, never>
const EMPTY_CTX: ScmCtx = {}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
}

const CONNECTION_TYPE_LABEL: Record<string, string> = {
  pull_request: 'Pull Request',
  build: 'Build',
  branch: 'Branch',
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="truncate text-primary hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  )
}

// ── Column definitions (config-driven, rendered by table.renderCells) ─────────

type ConnColKey = 'name' | 'type' | 'url' | 'createdAt'
const CONNECTION_COLUMNS: ColumnSpec<ScmConnection, ScmCtx, ConnColKey>[] = [
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 320,
    minWidth: 160,
    locked: true,
    grow: true,
    cellClassName: 'flex min-w-0 items-center px-2',
    // Name is plain text; the Url column carries the link (matches Rally).
    cell: (c) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-foreground" title={c.name}>
          {c.name}
        </span>
        {c.state ? <span className="text-ui-xs text-foreground-subtle">({c.state})</span> : null}
      </span>
    ),
  },
  {
    key: 'type',
    label: 'Type',
    defaultWidth: 130,
    minWidth: 90,
    cellClassName: 'flex items-center px-2',
    accessor: (c) => CONNECTION_TYPE_LABEL[c.type] ?? c.type,
    type: 'text',
  },
  {
    key: 'url',
    label: 'Url',
    defaultWidth: 300,
    minWidth: 140,
    cellClassName: 'flex min-w-0 items-center px-2',
    cell: (c) => <ExtLink href={c.url}>{c.url}</ExtLink>,
  },
  {
    key: 'createdAt',
    label: 'Creation Date',
    defaultWidth: 190,
    minWidth: 120,
    cellClassName: 'flex items-center px-2 text-muted-foreground',
    cell: (c) => <span className="whitespace-nowrap">{fmtDate(c.createdAt)}</span>,
  },
]

type ChangeColKey = 'name' | 'message' | 'changes' | 'author' | 'committedAt' | 'uri'
const CHANGESET_COLUMNS: ColumnSpec<ScmChangeset, ScmCtx, ChangeColKey>[] = [
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 130,
    minWidth: 90,
    locked: true,
    cellClassName: 'flex items-center px-2',
    cell: (c) => (
      <span className="font-mono whitespace-nowrap">
        {c.uri ? <ExtLink href={c.uri}>{c.name}</ExtLink> : c.name}
      </span>
    ),
  },
  {
    key: 'message',
    label: 'Message',
    defaultWidth: 360,
    minWidth: 160,
    grow: true,
    cellClassName: 'flex min-w-0 items-center px-2',
    cell: (c) => (
      <span className="block truncate" title={c.message ?? ''}>
        {c.message ?? '—'}
      </span>
    ),
  },
  {
    key: 'changes',
    label: 'Changes',
    defaultWidth: 300,
    minWidth: 140,
    // One link per changed file (each opens the commit). Stacked, matching Rally.
    cellClassName: 'flex min-w-0 flex-col justify-center gap-0.5 px-2 py-1',
    cell: (c) =>
      c.changes.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <>
          {c.changes.map((x) => (
            <span
              key={x.path}
              className="truncate font-mono text-ui-xs"
              title={`${x.action} ${x.path}`}
            >
              <span className="mr-1 text-foreground-subtle">{x.action}</span>
              {c.uri ? <ExtLink href={c.uri}>{x.path}</ExtLink> : x.path}
            </span>
          ))}
        </>
      ),
  },
  {
    key: 'author',
    label: 'Author',
    defaultWidth: 160,
    minWidth: 100,
    cellClassName: 'flex items-center px-2',
    accessor: (c) => c.authorName ?? '—',
    type: 'text',
  },
  {
    key: 'committedAt',
    label: 'Commit Timestamp',
    defaultWidth: 190,
    minWidth: 120,
    cellClassName: 'flex items-center px-2 text-muted-foreground',
    cell: (c) => <span className="whitespace-nowrap">{fmtDate(c.committedAt)}</span>,
  },
  {
    key: 'uri',
    label: 'Uri',
    defaultWidth: 280,
    minWidth: 140,
    cellClassName: 'flex min-w-0 items-center px-2',
    cell: (c) => (c.uri ? <ExtLink href={c.uri}>{c.uri}</ExtLink> : <span>—</span>),
  },
]

const ROW_CLASS =
  'flex min-h-[34px] items-center gap-2 border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter'

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase())
}

// ── Connections (Pull Requests) sub-tab ──────────────────────────────────────

function ConnectionsSubTab({ workItemId }: { workItemId: string }) {
  const { data, isLoading } = useWorkItemConnections(workItemId)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | ScmConnection['type']>('all')
  const table = useDataTable<ScmConnection, ScmCtx, ConnColKey>(CONNECTION_COLUMNS, {
    storageKey: STORAGE_KEYS.SCM_CONNECTIONS_COLUMNS,
  })

  const filtered = useMemo(() => {
    const rows = data?.data ?? []
    return rows.filter(
      (c) =>
        (typeFilter === 'all' || c.type === typeFilter) &&
        (search.trim() === '' || includesCI(`${c.name} ${c.url}`, search)),
    )
  }, [data, search, typeFilter])

  return (
    <ListPageScaffold<ScmConnection, ConnColKey>
      selectable={false}
      search={{
        value: search,
        onChange: setSearch,
        placeholder: 'Search connections…',
        width: 220,
      }}
      activeFilterCount={typeFilter === 'all' ? 0 : 1}
      filters={
        <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
          Type
          <InlineSelect
            value={typeFilter}
            aria-label="Filter by type"
            onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
            className="w-auto"
          >
            <option value="all">All types</option>
            <option value="pull_request">Pull Request</option>
            <option value="build">Build</option>
            <option value="branch">Branch</option>
          </InlineSelect>
        </label>
      }
      fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      headerProps={table.headerProps}
      headerColumns={table.headerColumns}
      colStyles={table.colStyles}
      padClassName="gap-2 px-3"
      items={filtered}
      loading={isLoading}
      skeleton={{ rows: 6 }}
      empty={
        filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-ui-sm text-foreground-subtle">
            No pull requests linked. Reference this item's key in a PR title, branch, or commit.
          </div>
        ) : undefined
      }
      renderRow={(c) => (
        <div key={c.id} className={ROW_CLASS} style={{ minWidth: 'max-content' }}>
          {table.renderCells(c, EMPTY_CTX)}
        </div>
      )}
    />
  )
}

// ── Changesets (commits) sub-tab ─────────────────────────────────────────────

function ChangesetsSubTab({ workItemId }: { workItemId: string }) {
  const { data, isLoading } = useWorkItemChangesets(workItemId)
  const [search, setSearch] = useState('')
  const table = useDataTable<ScmChangeset, ScmCtx, ChangeColKey>(CHANGESET_COLUMNS, {
    storageKey: STORAGE_KEYS.SCM_CHANGESETS_COLUMNS,
  })

  const filtered = useMemo(() => {
    const rows = data?.data ?? []
    if (search.trim() === '') return rows
    return rows.filter((c) =>
      includesCI(`${c.name} ${c.message ?? ''} ${c.authorName ?? ''}`, search),
    )
  }, [data, search])

  return (
    <ListPageScaffold<ScmChangeset, ChangeColKey>
      selectable={false}
      search={{ value: search, onChange: setSearch, placeholder: 'Search changesets…', width: 220 }}
      fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      headerProps={table.headerProps}
      headerColumns={table.headerColumns}
      colStyles={table.colStyles}
      padClassName="gap-2 px-3"
      items={filtered}
      loading={isLoading}
      skeleton={{ rows: 6 }}
      empty={
        filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-ui-sm text-foreground-subtle">
            No commits linked. Reference this item's key in a commit message.
          </div>
        ) : undefined
      }
      renderRow={(c) => (
        <div key={c.id} className={ROW_CLASS} style={{ minWidth: 'max-content' }}>
          {table.renderCells(c, EMPTY_CTX)}
        </div>
      )}
    />
  )
}

// ── Tab entry ─────────────────────────────────────────────────────────────────

export function ConnectionsTab({ workItemId }: { workItemId: string }) {
  const [tab, setTab] = useState<'connections' | 'changesets'>('connections')
  const { data: conns } = useWorkItemConnections(workItemId)
  const { data: changes } = useWorkItemChangesets(workItemId)

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as typeof tab)}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <TabsList className="shrink-0 px-4">
        <TabsTrigger value="connections" icon={<GitPullRequest size={13} />} count={conns?.total}>
          Connections
        </TabsTrigger>
        <TabsTrigger
          value="changesets"
          icon={<GitCommitHorizontal size={13} />}
          count={changes?.total}
        >
          Changesets
        </TabsTrigger>
      </TabsList>
      <TabsContent value="connections" className="flex flex-1 flex-col overflow-hidden">
        <ConnectionsSubTab workItemId={workItemId} />
      </TabsContent>
      <TabsContent value="changesets" className="flex flex-1 flex-col overflow-hidden">
        <ChangesetsSubTab workItemId={workItemId} />
      </TabsContent>
    </Tabs>
  )
}
