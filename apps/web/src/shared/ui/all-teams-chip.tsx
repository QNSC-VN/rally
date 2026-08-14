/**
 * `All Teams` — the badge an `Admin` access level carries instead of a Team picker.
 *
 * SRS §2.2 :51: "Admin always receives `All Teams`; individual Team selection is not shown." So this
 * is not decoration, it is the answer to "which teams?" for a level that has no team rows to list —
 * and the reason an Admin's row shows a chip where an Editor's shows names.
 *
 * Shared because it appeared twice, byte-identical, in the two access journeys that §5 requires to
 * "update the same Project access and Team membership source". A label those two screens could word
 * differently is the same class of drift as the three duplicated access-level option arrays that
 * `shared/config/access-levels.ts` now owns.
 */
import { useTranslation } from 'react-i18next'
import { CheckSquare } from 'lucide-react'

export function AllTeamsChip() {
  const { t } = useTranslation('settings')
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded border border-border-subtle bg-surface-hover px-2 py-0.5 text-ui-xs font-medium text-foreground">
      <CheckSquare size={11} /> {t('access.allTeams')}
    </span>
  )
}
