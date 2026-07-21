import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Pencil, Trash2, ExternalLink } from 'lucide-react'

import { useUpdateRelease, type Release, type ReleaseStatus } from '@/features/releases/api'
import { notify } from '@/shared/lib/toast'
import { IconButton } from '@/shared/ui/icon-button'
import { InlineSelect } from '@/shared/ui/native-select'
import { StatusBadge as StatusPill } from '@/shared/ui/status-badge'
import { type ColKey } from '../model/columns'
import { RELEASE_STATES, RELEASE_STATUS_STYLE } from '../model/release-states'

// ── Inline editable row ───────────────────────────────────────────────────

export function ReleaseRow({
  release,
  projectId,
  canManage,
  onDelete,
  colStyleFor,
}: {
  release: Release
  projectId: string
  canManage: boolean
  onDelete: (id: string) => void
  colStyleFor: (key: ColKey, base?: CSSProperties) => CSSProperties
}) {
  const { t } = useTranslation('releases')
  const update = useUpdateRelease(release.id, projectId)
  const status = release.status as ReleaseStatus

  function handleStateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newState = e.target.value as ReleaseStatus
    update.mutate(
      { state: newState },
      {
        onSuccess: () =>
          notify.success(t('row.statusUpdated', { label: RELEASE_STATUS_STYLE[newState].label })),
        onError: (err) => notify.error(err.message),
      },
    )
  }

  function handleNameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    if (val && val !== release.name) {
      update.mutate(
        { name: val },
        {
          onSuccess: () => notify.success(t('row.nameUpdated')),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  function handleThemeBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    if (val !== (release.theme ?? '')) {
      update.mutate(
        { theme: val || undefined },
        {
          onSuccess: () => notify.success(t('row.themeUpdated')),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  function handleVersionBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    if (val !== (release.version ?? '')) {
      update.mutate(
        { version: val || undefined },
        {
          onSuccess: () => notify.success(t('row.versionUpdated')),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  function handleVelocityBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    const num = val === '' ? null : Number(val)
    if (num !== null && (isNaN(num) || num < 0)) {
      notify.error(t('row.velocityInvalid'))
      e.target.value = release.plannedVelocity != null ? String(release.plannedVelocity) : ''
      return
    }
    if (num !== release.plannedVelocity) {
      update.mutate(
        { plannedVelocity: num ?? undefined },
        {
          onSuccess: () => notify.success(t('row.velocityUpdated')),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  function handleStartDateBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val !== (release.startDate ?? '')) {
      update.mutate(
        { startDate: val || undefined },
        {
          onSuccess: () => notify.success(t('row.startDateUpdated')),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  function handleReleaseDateBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val !== (release.releaseDate ?? '')) {
      update.mutate(
        { releaseDate: val || undefined },
        {
          onSuccess: () => notify.success(t('row.releaseDateUpdated')),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  const navigate = useNavigate()

  function openDetail() {
    void navigate({ to: '/releases/$releaseId', params: { releaseId: release.id } })
  }

  return (
    <div
      onClick={openDetail}
      className="group flex h-8 cursor-pointer items-center border-b border-border-inner px-3 text-ui-sm hover:bg-surface-hover"
    >
      {/* Name — inline editable (P3-REL-FR-005) */}
      <div
        style={colStyleFor('name', { flexShrink: 0 })}
        className="flex items-center pr-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.name}
            defaultValue={release.name}
            onBlur={handleNameBlur}
            aria-label="Release name"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm font-semibold text-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block truncate font-semibold text-foreground">{release.name}</span>
        )}
      </div>

      {/* Theme (P3-REL-FR-005) */}
      <div
        style={colStyleFor('theme', { flexShrink: 0 })}
        className="truncate pr-2 text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.theme}
            defaultValue={release.theme ?? ''}
            onBlur={handleThemeBlur}
            aria-label="Theme"
            placeholder="—"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block truncate">{release.theme || '—'}</span>
        )}
      </div>

      {/* Version */}
      <div
        style={colStyleFor('version', { flexShrink: 0 })}
        className="truncate pr-2 text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.version}
            defaultValue={release.version ?? ''}
            onBlur={handleVersionBlur}
            aria-label="Version"
            placeholder="—"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block truncate">{release.version || '—'}</span>
        )}
      </div>

      {/* Start Date — inline editable */}
      <div
        style={colStyleFor('startDate', { flexShrink: 0 })}
        className="text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.startDate}
            type="date"
            defaultValue={release.startDate ?? ''}
            onBlur={handleStartDateBlur}
            aria-label="Start date"
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span>{release.startDate ?? '—'}</span>
        )}
      </div>

      {/* Release Date — inline editable */}
      <div
        style={colStyleFor('releaseDate', { flexShrink: 0 })}
        className="text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.releaseDate}
            type="date"
            defaultValue={release.releaseDate ?? ''}
            onBlur={handleReleaseDateBlur}
            aria-label="Release date"
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span>{release.releaseDate ?? '—'}</span>
        )}
      </div>

      {/* Planned Velocity — inline editable */}
      <div
        style={colStyleFor('plannedVelocity', { flexShrink: 0 })}
        className="pr-2 text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.plannedVelocity}
            defaultValue={release.plannedVelocity != null ? String(release.plannedVelocity) : ''}
            onBlur={handleVelocityBlur}
            aria-label="Planned velocity"
            placeholder="—"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-right font-mono text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block text-right font-mono tabular-nums">
            {release.plannedVelocity ?? '—'}
          </span>
        )}
      </div>

      {/* Task Estimate — read-only roll-up of assigned work-item estimate hours (P3-REL-FR-004) */}
      <div
        style={colStyleFor('taskEstimate', { flexShrink: 0 })}
        className="pr-2 text-right font-mono text-muted-foreground tabular-nums"
        onClick={(e) => e.stopPropagation()}
      >
        <span>{release.taskEstimate ?? 0}</span>
      </div>

      {/* State (P3-REL-FR-008) */}
      <div style={colStyleFor('state', { flexShrink: 0 })} onClick={(e) => e.stopPropagation()}>
        {canManage ? (
          <InlineSelect
            value={status}
            onChange={handleStateChange}
            className="rounded border border-border-subtle bg-card px-1 py-0.5 text-ui-sm text-foreground focus:outline-none"
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>
                {RELEASE_STATUS_STYLE[s].label}
              </option>
            ))}
          </InlineSelect>
        ) : (
          <StatusPill style={RELEASE_STATUS_STYLE[status] ?? RELEASE_STATUS_STYLE.planning} />
        )}
      </div>

      {/* Actions */}
      <div style={colStyleFor('actions', { flexShrink: 0 })}>
        {canManage && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <IconButton
              size="sm"
              aria-label="Open detail"
              title="Open detail"
              onClick={(e) => {
                e.stopPropagation()
                openDetail()
              }}
            >
              <Pencil size={12} />
            </IconButton>
            <IconButton
              size="sm"
              aria-label="Detail"
              title="Detail"
              onClick={(e) => {
                e.stopPropagation()
                openDetail()
              }}
            >
              <ExternalLink size={12} />
            </IconButton>
            {status !== 'accepted' && (
              <IconButton
                size="sm"
                variant="destructive"
                aria-label="Delete release"
                title="Delete release"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(release.id)
                }}
              >
                <Trash2 size={12} />
              </IconButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
