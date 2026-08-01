import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, GitBranch, RefreshCw, Trash2 } from 'lucide-react'

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
import { Card, CardHeader, CardBody } from '@/shared/ui/card'
import { IconButton } from '@/shared/ui/icon-button'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/empty-state'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { useDisclosure } from '@/shared/lib/hooks/use-disclosure'

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

  // Client-side pagination — auto-discovery can register many repos.
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(repos.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRepos = useMemo(
    () => repos.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [repos, currentPage, pageSize],
  )

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
    <>
      <Card>
        <CardHeader
          title={t('integrations.repos.title')}
          actions={
            repos.length > 0 ? (
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
            ) : undefined
          }
        />
        <CardBody className="p-0">
          {isLoading ? (
            <p className="px-4 py-6 text-ui-sm text-foreground-subtle">
              {t('integrations.loading')}
            </p>
          ) : repos.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                icon={<GitBranch size={22} className="text-border-strong" />}
                title={t('integrations.repos.empty.title')}
                description={t('integrations.repos.empty.description')}
              />
            </div>
          ) : (
            <>
              <table className="w-full border-collapse text-ui-sm">
                <thead className="bg-surface-subtle">
                  <tr className="text-left text-ui-xs text-foreground-subtle">
                    <th className="px-3 py-2 font-semibold">
                      {t('integrations.repos.col.repository')}
                    </th>
                    <th className="px-3 py-2 font-semibold">
                      {t('integrations.repos.col.status')}
                    </th>
                    <th className="px-3 py-2 font-semibold">
                      {t('integrations.repos.col.activity')}
                    </th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pageRepos.map((r) => {
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
                            : '--'}
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
              {repos.length > 10 && (
                <PaginationFooter
                  pageSize={pageSize}
                  setPageSize={(n) => {
                    setPageSize(n)
                    setPage(1)
                  }}
                  currentPage={currentPage}
                  rangeStart={(currentPage - 1) * pageSize + 1}
                  rangeEnd={Math.min(currentPage * pageSize, repos.length)}
                  total={repos.length}
                  pageCount={pageCount}
                  hasPrevPage={currentPage > 1}
                  hasNextPage={currentPage < pageCount}
                  onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
                  onNextPage={() => setPage((p) => Math.min(pageCount, p + 1))}
                />
              )}
            </>
          )}
        </CardBody>
      </Card>

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
    </>
  )
}
