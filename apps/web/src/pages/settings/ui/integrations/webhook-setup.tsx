import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { CopyButton } from '@/shared/ui/copy-button'
import { useDisclosure } from '@/shared/lib/hooks/use-disclosure'

const PROVIDERS = ['github', 'ghe'] as const

/**
 * Collapsible manual-webhook instructions + copyable webhook URLs. Only needed
 * for repositories outside a connected GitHub App installation (the App delivers
 * events automatically for everything it can access).
 */
export function WebhookSetup() {
  const { t } = useTranslation('settings')
  const { isOpen, toggle } = useDisclosure()
  const origin = window.location.origin

  return (
    <section className="rounded-lg border border-border-subtle">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-ui-sm font-medium text-foreground"
      >
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {t('integrations.webhook.title')}
      </button>
      {isOpen && (
        <div className="space-y-3 border-t border-border-inner px-3 py-3">
          <p className="text-ui-xs text-foreground-subtle">
            {t('integrations.webhook.description')}
          </p>
          <div className="space-y-2">
            {PROVIDERS.map((p) => {
              const url = `${origin}/v1/scm/webhook/${p}`
              return (
                <div key={p} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-ui-xs text-foreground-subtle uppercase">
                    {p}
                  </span>
                  <code className="flex-1 truncate rounded bg-surface-subtle px-2 py-1 font-mono text-ui-xs text-foreground">
                    {url}
                  </code>
                  <CopyButton value={url} label={t('integrations.webhook.copy')} />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
