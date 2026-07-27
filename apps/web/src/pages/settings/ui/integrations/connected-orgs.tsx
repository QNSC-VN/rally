import { useTranslation } from 'react-i18next'
import { Building2, GitBranch, Plus } from 'lucide-react'

import {
  useScmInstallations,
  useScmRepositories,
  useDisconnectGitHub,
  type ScmInstallation,
} from '@/features/scm/api'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { Card, CardHeader, CardBody } from '@/shared/ui/card'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { EmptyState } from '@/shared/ui/empty-state'
import { Spinner } from '@/shared/ui/spinner'
import { useDisclosure } from '@/shared/lib/hooks/use-disclosure'
import { ConnectInstallationDialog } from './connect-installation-dialog'

interface ConnectedOrgsProps {
  workspaceId: string | undefined
}

/**
 * Dashboard header — GitHub App installations bound to this workspace. Each shows
 * its org login + discovered-repo count, with a Disconnect (confirmed) action.
 * When none are connected, prompts to connect one via {@link ConnectInstallationDialog}.
 */
export function ConnectedOrgs({ workspaceId }: ConnectedOrgsProps) {
  const { t } = useTranslation('settings')
  const { data: installations = [], isLoading } = useScmInstallations(workspaceId)
  const { data: repos = [] } = useScmRepositories(workspaceId)
  const disconnect = useDisconnectGitHub(workspaceId)
  const connectDialog = useDisclosure()
  const confirm = useDisclosure<ScmInstallation>()

  function label(i: ScmInstallation): string {
    return i.accountLogin ?? t('integrations.orgs.installation', { id: i.installationId })
  }

  function repoCount(installationId: string): number {
    return repos.filter((r) => r.installationId === installationId && r.active).length
  }

  async function onDisconnect(i: ScmInstallation) {
    try {
      await disconnect.mutateAsync(i.installationId)
      notify.success(t('integrations.disconnected', { name: label(i) }))
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Failed to disconnect')
    } finally {
      confirm.close()
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title={t('integrations.orgs.title')}
          actions={
            installations.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => connectDialog.open()}
              >
                <Plus size={14} />
                {t('integrations.orgs.connect')}
              </Button>
            ) : undefined
          }
        />
        <CardBody className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-ui-sm text-foreground-subtle">
              <Spinner size="sm" />
              {t('integrations.loading')}
            </div>
          ) : installations.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                icon={<GitBranch size={22} className="text-border-strong" />}
                title={t('integrations.orgs.empty.title')}
                description={t('integrations.orgs.empty.description')}
                action={
                  <Button type="button" onClick={() => connectDialog.open()}>
                    <GitBranch size={14} />
                    {t('integrations.orgs.connect')}
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {installations.map((i) => (
                <div
                  key={i.installationId}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Building2 size={18} className="shrink-0 text-foreground-subtle" />
                    <div className="min-w-0">
                      <p className="truncate text-ui-md font-medium text-foreground">{label(i)}</p>
                      <p className="text-ui-sm text-foreground-subtle">
                        {t('integrations.orgs.repoCount', { count: repoCount(i.installationId) })}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    className="text-destructive hover:text-destructive"
                    onClick={() => confirm.open(i)}
                  >
                    {t('integrations.orgs.disconnect')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <ConnectInstallationDialog
        open={connectDialog.isOpen}
        onClose={connectDialog.close}
        workspaceId={workspaceId}
      />
      <ConfirmDialog
        open={confirm.isOpen}
        title={t('integrations.orgs.disconnectTitle', {
          name: confirm.data ? label(confirm.data) : '',
        })}
        message={t('integrations.orgs.disconnectMessage')}
        confirmLabel={t('integrations.orgs.disconnect')}
        destructive
        pending={disconnect.isPending}
        onConfirm={() => confirm.data && void onDisconnect(confirm.data)}
        onCancel={confirm.close}
      />
    </>
  )
}
