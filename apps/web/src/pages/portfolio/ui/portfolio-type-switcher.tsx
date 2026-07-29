import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/shared/ui/native-select'
import { PortfolioItemType } from '@/entities/work-item/model/types'

/**
 * Portfolio TYPE switcher — Epic / Feature.
 *
 * Lives in the page HEADER, not in the "Show Filters" panel, and deliberately so:
 * the API has no combined Epic+Feature view, so this control picks which portfolio
 * LEVEL you are looking at rather than narrowing a result set. Behind the filter
 * toggle it was invisible until opened, which made the page look like it only ever
 * showed Features.
 *
 * Mirrors `TimeboxTypeSwitcher` (the same label + `NativeSelect` shape) so the two
 * mode switches in the app read identically. It differs in holding STATE rather
 * than navigating, because both levels share one route.
 */
export function PortfolioTypeSwitcher({
  value,
  onChange,
}: {
  value: PortfolioItemType
  onChange: (next: PortfolioItemType) => void
}) {
  const { t } = useTranslation('portfolio')

  return (
    <label className="flex items-center gap-2">
      <span className="text-ui-xs font-semibold tracking-wide text-foreground-subtle">
        {t('filters.type')}
      </span>
      <NativeSelect
        aria-label={t('filters.type')}
        value={value}
        onChange={(e) => onChange(e.target.value as PortfolioItemType)}
        className="h-8 min-w-[8rem] py-1 text-ui-sm"
      >
        <option value={PortfolioItemType.Epic}>{t('types.epic')}</option>
        <option value={PortfolioItemType.Feature}>{t('types.feature')}</option>
      </NativeSelect>
    </label>
  )
}
