import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import {
  useCreatePortfolioItem,
  usePortfolioItems,
  type PortfolioItemState,
  type PreliminaryEstimateSize,
} from '@/features/portfolio/api'
import { PORTFOLIO_STATES, PRELIMINARY_ESTIMATE_SIZES } from '../model/portfolio-states'

/**
 * Create an Epic or a Feature.
 *
 * `type` is fixed by the caller (the list's current level) rather than being a field in
 * here: it is immutable after create, and the API has no combined view, so offering it as
 * a dropdown would let someone create an Epic while looking at the Feature list and
 * wonder where it went.
 *
 * The parent-Epic picker only appears for a Feature — an Epic has no parent by CHECK
 * constraint (`ck_portfolio_epic_shape`), so showing a disabled field would imply the
 * hierarchy goes deeper than two levels.
 */
export function CreatePortfolioItemModal({
  projectId,
  type,
  onClose,
}: {
  projectId: string
  type: PortfolioItemType
  onClose: () => void
}) {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const create = useCreatePortfolioItem()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<PortfolioItemState>('no_entry')
  const [size, setSize] = useState<PreliminaryEstimateSize>('no_entry')
  const [parentId, setParentId] = useState('')
  const [errors, setErrors] = useState<{ name?: string; form?: string }>({})

  const isFeature = type === PortfolioItemType.Feature
  // Only Epics in the SAME project are offerable: a Feature's Release must belong to its
  // project, and mixing projects across one Epic makes the rollup span projects in a way
  // the spec does not ask for.
  const { items: epics } = usePortfolioItems({ type: PortfolioItemType.Epic, projectId })

  async function submit(goToDetails: boolean) {
    if (!name.trim()) {
      setErrors({ name: t('create.nameRequired') })
      return
    }
    setErrors({})
    try {
      const result = await create.mutateAsync({
        projectId,
        type,
        name: name.trim(),
        description: description.trim() || undefined,
        state,
        preliminaryEstimate: size,
        ...(isFeature && parentId ? { parentId } : {}),
      })
      notify.success(t('create.created', { name: name.trim() }))
      onClose()
      if (goToDetails && result?.id) {
        void navigate({ to: '/portfolio/$itemId', params: { itemId: result.id } })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('create.createFailed')
      setErrors({ form: msg })
      notify.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={isFeature ? t('create.titleFeature') : t('create.titleEpic')}
      width={460}
    >
      <ModalBody className="space-y-4">
        {errors.form && (
          <p role="alert" className="text-ui-sm text-destructive">
            {errors.form}
          </p>
        )}

        {/* `htmlFor` + `id` are what actually tie the label to the control — FormField
            renders a bare <label> otherwise, leaving the input unlabelled for screen
            readers (and unfindable by an accessible-name query). */}
        <FormField
          label={t('create.nameLabel')}
          required
          error={errors.name}
          htmlFor="portfolio-name"
        >
          <Input
            id="portfolio-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>

        {isFeature && (
          <FormField label={t('detail.fields.parent')}>
            <SearchableSelect
              variant="field"
              value={parentId}
              ariaLabel={t('detail.fields.parent')}
              options={[
                { value: '', label: t('create.noEpic') },
                ...epics.map((e) => ({ value: e.id, label: `${e.itemKey} — ${e.name}` })),
              ]}
              onChange={(v) => setParentId(v ?? '')}
            />
          </FormField>
        )}

        <div className="flex gap-3">
          <FormField label={t('filters.state')} className="flex-1">
            <SearchableSelect
              variant="field"
              value={state}
              ariaLabel={t('filters.state')}
              options={PORTFOLIO_STATES.map((s) => ({ value: s, label: t(`states.${s}`) }))}
              onChange={(v) => setState(v as PortfolioItemState)}
            />
          </FormField>
          <FormField label={t('detail.fields.preliminaryEstimate')} className="flex-1">
            <SearchableSelect
              variant="field"
              value={size}
              ariaLabel={t('detail.fields.preliminaryEstimate')}
              options={PRELIMINARY_ESTIMATE_SIZES.map((s) => ({
                value: s,
                label: t(`sizes.${s}`),
              }))}
              onChange={(v) => setSize(v as PreliminaryEstimateSize)}
            />
          </FormField>
        </div>

        <FormField label={t('detail.fields.description')} htmlFor="portfolio-description">
          <Textarea
            id="portfolio-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
          onClick={() => void submit(true)}
        >
          {t('create.createWithDetails')}
        </Button>
        <Button
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => void submit(false)}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('create.createButton')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
