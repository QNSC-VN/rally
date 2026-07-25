/**
 * Settings ▸ Integrations — source-control (GitHub) dashboard.
 *
 * Org-level model: connect the Rally GitHub App once and its repositories are
 * discovered automatically (from `installation`/`installation_repositories`
 * webhooks) and back-filled. PRs/commits link to work items by their workspace-
 * unique key (Rally FormattedID) — no per-project mapping. A manual owner/name
 * fallback + copyable webhook URLs remain for repos outside an installation.
 */
import { useTranslation } from 'react-i18next'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { ConnectedOrgs } from './integrations/connected-orgs'
import { RepositoryList } from './integrations/repository-list'
import { WebhookSetup } from './integrations/webhook-setup'
import { ManualAddForm } from './integrations/manual-add-form'

export function IntegrationsTab() {
  const { t } = useTranslation('settings')
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h2 className="text-ui-lg font-semibold text-foreground">{t('integrations.title')}</h2>
        <p className="mt-1 text-ui-sm text-foreground-subtle">{t('integrations.subtitle')}</p>
      </header>

      <ConnectedOrgs workspaceId={workspaceId} />
      <RepositoryList workspaceId={workspaceId} />
      <WebhookSetup />
      <ManualAddForm workspaceId={workspaceId} />
    </div>
  )
}
