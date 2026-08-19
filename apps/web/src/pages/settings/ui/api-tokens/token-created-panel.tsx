/**
 * The credential, shown once.
 *
 * This is the only surface in the app that ever renders a usable API token, and it is the only one
 * that can: the database stores a SHA-256 hash, so no endpoint can return the value again. Every
 * decision here follows from that single fact.
 *
 *  • The value is selectable text next to a {@link CopyButton}, not a masked field with a reveal —
 *    there is nothing to reveal later, and a dot-mask would imply otherwise.
 *  • The warning is stated before the value, not under it. A person who has already copied and
 *    closed does not read the small print underneath.
 *  • Closing needs a deliberate click on "I have stored it", not an X in the corner. The cost of a
 *    mis-click here is a token nobody has and a mint nobody can undo, which is cheap to prevent and
 *    tedious to recover from.
 */
import { KeyRound, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CreatedApiToken } from '@/features/api-tokens/api'
import { Button } from '@/shared/ui/button'
import { CopyButton } from '@/shared/ui/copy-button'
import { ModalBody, ModalFooter } from '@/shared/ui/app-modal'

export function TokenCreatedPanel({
  token,
  onDone,
}: {
  token: CreatedApiToken
  onDone: () => void
}) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ModalBody className="space-y-4">
        <div className="flex items-start gap-2 rounded border border-warning-border bg-warning-bg px-3 py-2">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-ui-sm text-foreground">{t('apiTokens.created.warning')}</p>
        </div>

        <div>
          <p className="mb-1 text-ui-xs font-semibold tracking-wider text-foreground-subtle uppercase">
            {t('apiTokens.created.label', { name: token.name })}
          </p>
          <div className="flex items-center gap-2 rounded border border-border-subtle bg-surface-subtle px-3 py-2">
            {/* `break-all`, not `truncate`: a credential that is visually cut off is a credential
                somebody copies incompletely by hand when the clipboard is unavailable. */}
            <code className="min-w-0 flex-1 font-mono text-ui-sm break-all text-foreground">
              {token.token}
            </code>
            <CopyButton value={token.token} label={t('apiTokens.created.copy')} />
          </div>
        </div>

        <dl className="space-y-1 text-ui-sm text-foreground-subtle">
          <div className="flex gap-2">
            <dt>{t('apiTokens.col.prefix')}</dt>
            <dd className="font-mono text-foreground">{token.prefix}</dd>
          </div>
          <div className="flex gap-2">
            <dt>{t('apiTokens.col.expires')}</dt>
            <dd className="text-foreground">{new Date(token.expiresAt).toLocaleDateString()}</dd>
          </div>
        </dl>

        <p className="flex items-start gap-2 text-ui-sm text-foreground-subtle">
          <KeyRound size={14} className="mt-0.5 shrink-0" />
          {t('apiTokens.created.usage')}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={onDone}>
          {t('apiTokens.created.done')}
        </Button>
      </ModalFooter>
    </>
  )
}
