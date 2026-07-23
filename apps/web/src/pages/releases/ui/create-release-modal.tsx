import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { useCreateRelease, type ReleaseStatus } from '@/features/releases/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { DateField } from '@/shared/ui/date-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { RELEASE_STATES, RELEASE_STATUS_STYLE } from '../model/release-states'

// ── Create modal (P3-REL-FR-011/012: Type locked to Release) ─────────────

export function CreateReleaseModal({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const { t } = useTranslation('releases')
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [theme, setTheme] = useState('')
  const [status, setState] = useState<ReleaseStatus>('planning')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateRelease()

  async function submit(goToDetails?: boolean) {
    setError(null)
    if (!name.trim()) {
      setError(t('create.nameRequired'))
      return
    }
    if (startDate && releaseDate && releaseDate < startDate) {
      setError(t('create.dateOrder'))
      return
    }
    try {
      const result = await create.mutateAsync({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        theme: theme.trim() || undefined,
        startDate: startDate || undefined,
        releaseDate: releaseDate || undefined,
        state: status,
      })
      notify.success(t('create.created', { name: name.trim() }))
      onClose()
      if (goToDetails && result?.id) {
        void navigate({ to: '/releases/$releaseId', params: { releaseId: result.id } })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('create.createFailed')
      setError(msg)
      notify.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('create.title')}
      subtitle={t('create.subtitle')}
      width={460}
    >
      <ModalBody className="space-y-4">
        {/* Type selector — disabled, locked to Release (P3-REL-FR-012) */}
        <FormField label={t('create.typeLabel')}>
          <div className="flex gap-2">
            {(['Iteration', 'Release', 'Milestones'] as const).map((type) => (
              <button
                key={type}
                type="button"
                disabled={type !== 'Release'}
                className="flex-1 rounded-sm py-1.5 text-ui-sm font-semibold transition-colors"
                style={{
                  backgroundColor: type === 'Release' ? BRAND.primaryLighter : 'transparent',
                  color: type === 'Release' ? BRAND.primary : BRAND.textMuted,
                  border: `1px solid ${type === 'Release' ? BRAND.accentBorder : BRAND.borderSubtle}`,
                  opacity: type === 'Release' ? 1 : 0.4,
                  cursor: type === 'Release' ? 'default' : 'not-allowed',
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label={t('create.nameLabel')} required error={error ?? undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="v1.2.0 — Q3 Feature Drop"
            autoFocus
          />
        </FormField>

        <div className="flex gap-3">
          <FormField label={t('create.themeLabel')} className="flex-1">
            <Input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="e.g. Security & Perf"
            />
          </FormField>
        </div>

        <div className="flex gap-3">
          <FormField label={t('create.startDateLabel')} className="flex-1">
            <DateField
              variant="field"
              value={startDate || null}
              ariaLabel={t('create.startDateLabel')}
              onChange={(v) => setStartDate(v ?? '')}
            />
          </FormField>
          <FormField label={t('create.releaseDateLabel')} className="flex-1">
            <DateField
              variant="field"
              value={releaseDate || null}
              ariaLabel={t('create.releaseDateLabel')}
              onChange={(v) => setReleaseDate(v ?? '')}
            />
          </FormField>
        </div>

        <FormField label={t('create.statusLabel')}>
          <SearchableSelect
            variant="field"
            value={status}
            ariaLabel={t('create.statusLabel')}
            options={RELEASE_STATES.map((s) => ({
              value: s,
              label: RELEASE_STATUS_STYLE[s].label,
            }))}
            onChange={(v) => setState(v as ReleaseStatus)}
          />
        </FormField>

        <FormField label={t('create.descriptionLabel')}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What ships in this release?"
            rows={3}
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => {
            void submit(true)
          }}
        >
          {t('createWithDetails')}
        </Button>
        <Button
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => {
            void submit(false)
          }}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('createButton')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
