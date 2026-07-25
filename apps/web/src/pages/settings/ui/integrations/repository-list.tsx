import { useTranslation } from 'react-i18next'
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react'

import {
  useScmRepositories,
  useSyncScmRepository,
  useDeleteScmRepository,
  type ScmRepository,
} from '@/features/scm/api'
import { SCM_SYNC_STATUS_STYLE, NEVER_SYNCED_STYLE } from '@/features/scm/status-colors'
import { notify } from '@/shared/lib/toast'
import { relativeTime } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/empty-state'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useDisclosure } from '@/shared/lib/hooks/use-disclosure'
import { GitBranch } from 'lucide-react'

interface RepositoryListProps {
  workspaceId: string | undefined
}

function repoUrl(r: ScmRepository): string {
  const base = r.baseUrl?.replace(/\/$/, '') ?? 'https://github.com'
  return `${base}/${r.fullName}`
}

/** Repositories (discovered + manual) with their latest sync status and per-row actions. */
export function RepositoryList({ workspaceId }: RepositoryListProps) {
  const { t } = useTranslation('settings')
  const { data: repos = [], isLoading } = useScmRepositories(workspaceId)
  const syncRepo = useSyncScmRepository(workspaceId)
  const deleteRepo = useDeleteScmRepository(workspaceId)
  const confirm = useDisclosure<ScmRepository>()

  function sync(r: ScmRepository) {
    void syncRepo
      .mutateAsync(r.id)
      .then(() => notify.success(t('integrations.syncQueued', { name: r.fullName })))
      .catch((e: unknown) => notify.error(e instanceof Error ? e.message : 'Failed to sync'))
  }

  function syncAll() {
    repos.forEach((r) => syncRepo.mutate(r.id))
    notify.success(t('integrations.syncAllQueued', { count: repos.length }))
  }

  async function onRemove(r: ScmRepository) {
    try {
      await deleteRepo.mutateAsync(r.id)
      notify.success(t('integrations.removed', { name: r.fullName }))
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Failed to remove')
    } finally {
      confirm.close()
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-ui-md font-semibold text-foreground">
          {t('integrations.repos.title')}
        </h3>
        {repos.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={syncRepo.isPending}
            onClick={syncAll}
          >
            <RefreshCw size={14} />
            {t('integrations.repos.syncAll')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-ui-sm text-foreground-subtle">{t('integrations.loading')}</p>
      ) : repos.length === 0 ? (
        <EmptyState
          icon={<GitBranch size={22} className="text-border-strong" />}
          title={t('integrations.repos.empty.title')}
          description={t('integrations.repos.empty.description')}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle">
          <table className="w-full border-collapse text-ui-sm">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-ui-xs text-foreground-subtle">
                <th className="px-3 py-2 font-semibold">
                  {t('integrations.repos.col.repository')}
                </th>
                <th className="px-3 py-2 font-semibold">{t('integrations.repos.col.status')}</th>
                <th className="px-3 py-2 font-semibold">{t('integrations.repos.col.activity')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => {
                const style = r.lastSync
                  ? SCM_SYNC_STATUS_STYLE[r.lastSync.status]
                  : NEVER_SYNCED_STYLE
                const syncing = syncRepo.isPending && syncRepo.variables === r.id
                return (
                  <tr key={r.id} className="border-t border-border-inner">
                    <td className="px-3 py-2">
                      <a
                        href={repoUrl(r)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-foreground hover:text-primary"
                      >
                        {r.fullName}
                        <ExternalLink size={12} className="text-foreground-subtle" />
                      </a>
                      {!r.installationId && (
                        <span className="ml-2 text-ui-xs text-foreground-subtle">
                          {t('integrations.repos.manual')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge style={style} className="w-fit" />
                        <span className="text-ui-xs text-foreground-subtle">
                          {r.lastSync?.at
                            ? t('integrations.repos.syncedAt', {
                                time: relativeTime(r.lastSync.at),
                              })
                            : t('integrations.repos.neverSynced')}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-foreground-subtle">
                      {r.lastSync
                        ? `${t('integrations.repos.prs', { count: r.lastSync.prs })} · ${t('integrations.repos.commits', { count: r.lastSync.commits })}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <IconButton
                        size="sm"
                        aria-label={t('integrations.syncAria', { name: r.fullName })}
                        title={t('integrations.sync')}
                        className="mr-1"
                        disabled={syncing}
                        onClick={() => sync(r)}
                      >
                        <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="destructive"
                        aria-label={t('integrations.remove', { name: r.fullName })}
                        onClick={() => confirm.open(r)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirm.isOpen}
        title={t('integrations.removeTitle', { name: confirm.data?.fullName ?? '' })}
        message={t('integrations.removeMessage')}
        confirmLabel={t('integrations.remove', { name: confirm.data?.fullName ?? '' })}
        destructive
        pending={deleteRepo.isPending}
        onConfirm={() => confirm.data && void onRemove(confirm.data)}
        onCancel={confirm.close}
      />
    </section>
  )
}
