import { useTranslation } from 'react-i18next'
import { Building2, Check } from 'lucide-react'

import {
  useScmInstallationsAvailable,
  useConnectGitHub,
  type ScmInstallation,
} from '@/features/scm/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { Spinner } from '@/shared/ui/spinner'

interface ConnectInstallationDialogProps {
  open: boolean
  onClose: () => void
  workspaceId: string | undefined
}

/**
 * Picker of GitHub App installations the App can see. Connecting one binds it to
 * the workspace and auto-discovers + back-fills its repositories.
 */
export function ConnectInstallationDialog({
  open,
  onClose,
  workspaceId,
}: ConnectInstallationDialogProps) {
  const { t } = useTranslation('settings')
  const { data: available = [], isLoading } = useScmInstallationsAvailable(workspaceId, open)
  const connect = useConnectGitHub(workspaceId)

  function label(i: ScmInstallation): string {
    return i.accountLogin ?? t('integrations.orgs.installation', { id: i.installationId })
  }

  async function onConnect(i: ScmInstallation) {
    try {
      const res = await connect.mutateAsync(i.installationId)
      notify.success(t('integrations.connected', { name: label(i), count: res?.discovered ?? 0 }))
      onClose()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Failed to connect')
    }
  }

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={t('integrations.connectDialog.title')}
      subtitle={t('integrations.connectDialog.description')}
      width={520}
    >
      <ModalBody>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-ui-sm text-foreground-subtle">
            <Spinner size="sm" />
            {t('integrations.connectDialog.loading')}
          </div>
        ) : available.length === 0 ? (
          <p className="py-4 text-ui-sm text-foreground-subtle">
            {t('integrations.connectDialog.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border-inner">
            {available.map((i) => (
              <li key={i.installationId} className="flex items-center gap-3 py-2.5">
                <Building2 size={18} className="shrink-0 text-foreground-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui-sm font-medium text-foreground">{label(i)}</p>
                  {i.accountType && (
                    <p className="text-ui-xs text-foreground-subtle">{i.accountType}</p>
                  )}
                </div>
                {i.connected ? (
                  <span className="inline-flex items-center gap-1 text-ui-xs text-success">
                    <Check size={14} />
                    {t('integrations.connectDialog.connected')}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    type="button"
                    disabled={connect.isPending}
                    onClick={() => void onConnect(i)}
                  >
                    {t('integrations.connectDialog.connect')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </ModalBody>
    </AppModal>
  )
}
