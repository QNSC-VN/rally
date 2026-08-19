/**
 * Settings ▸ API Tokens ▸ New token.
 *
 * Two steps in one modal: the form, then {@link TokenCreatedPanel} holding the credential the mint
 * returned. They are one modal rather than two because the second is not optional — a mint that
 * closes without showing its token has produced a credential nobody has, and there is no way to ask
 * for it again.
 *
 * The expiry bounds and the scope ceiling are both mirrored from the backend. That duplication is
 * deliberate: the alternative is a form that offers a choice the API refuses, which spends a round
 * trip to tell someone that the thing the UI suggested is not allowed.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  TOKEN_EXPIRY_DEFAULT_DAYS,
  TOKEN_EXPIRY_MAX_DAYS,
  useCreateApiToken,
  type CreatedApiToken,
} from '@/features/api-tokens/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { TokenCreatedPanel } from './token-created-panel'

/**
 * The lifetimes offered. Not a free-text day count: a picker cannot produce 0, 400 or "ninety", and
 * every option here is one the API accepts.
 */
const EXPIRY_OPTIONS = [7, 30, TOKEN_EXPIRY_DEFAULT_DAYS, 180, TOKEN_EXPIRY_MAX_DAYS] as const

export function CreateTokenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const create = useCreateApiToken()

  const [name, setName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState<number>(TOKEN_EXPIRY_DEFAULT_DAYS)
  const [minted, setMinted] = useState<CreatedApiToken | null>(null)
  const [nameError, setNameError] = useState<string | undefined>(undefined)

  function reset() {
    setName('')
    setExpiresInDays(TOKEN_EXPIRY_DEFAULT_DAYS)
    // Dropped on close so a live credential does not outlive the modal that showed it.
    setMinted(null)
    setNameError(undefined)
  }

  function close() {
    reset()
    onClose()
  }

  async function submit() {
    const label = name.trim()
    if (!label) {
      // A name is required by the API, and it is what the list is read by: "the CI one" is the
      // difference between revoking with confidence and guessing.
      setNameError(t('apiTokens.create.nameRequired'))
      return
    }
    setNameError(undefined)
    try {
      const created = await create.mutateAsync({ name: label, expiresInDays })
      setMinted(created)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t('apiTokens.create.failed'))
    }
  }

  return (
    <AppModal
      open={open}
      onClose={close}
      title={minted ? t('apiTokens.created.title') : t('apiTokens.create.title')}
      subtitle={minted ? undefined : t('apiTokens.create.subtitle')}
      width={520}
    >
      {minted ? (
        <TokenCreatedPanel token={minted} onDone={close} />
      ) : (
        <>
          <ModalBody className="space-y-4">
            <FormField
              label={t('apiTokens.create.nameLabel')}
              htmlFor="api-token-name"
              required
              hint={t('apiTokens.create.nameHint')}
              error={nameError}
            >
              <Input
                id="api-token-name"
                value={name}
                autoFocus
                maxLength={80}
                placeholder={t('apiTokens.create.namePlaceholder')}
                aria-invalid={nameError ? true : undefined}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>

            <FormField
              label={t('apiTokens.create.expiryLabel')}
              htmlFor="api-token-expiry"
              hint={t('apiTokens.create.expiryHint', { max: TOKEN_EXPIRY_MAX_DAYS })}
            >
              <NativeSelect
                id="api-token-expiry"
                value={String(expiresInDays)}
                onChange={(event) => setExpiresInDays(Number(event.target.value))}
              >
                {EXPIRY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {t('apiTokens.create.expiryOption', { count: days })}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <p className="text-ui-sm text-foreground-subtle">{t('apiTokens.create.scopeNote')}</p>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={create.isPending}>
              {t('apiTokens.create.cancel')}
            </Button>
            <Button type="button" disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? t('apiTokens.create.pending') : t('apiTokens.create.submit')}
            </Button>
          </ModalFooter>
        </>
      )}
    </AppModal>
  )
}
