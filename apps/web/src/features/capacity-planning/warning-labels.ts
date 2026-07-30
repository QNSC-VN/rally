import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { CapacityWarning } from './api'

/**
 * Resolves warning codes to sentences, in the order the API sent them.
 *
 * One resolver for every surface that shows a warning — team rows, Feature rows and the
 * Breakdown overlay — because a rule that reads differently in two places is worse than a
 * rule with no explanation at all. The API already orders the codes cause-first, so this
 * deliberately does NOT sort: a missing estimate is why the rollup exceeds it, and
 * re-ordering here would bury the fixable cause under its own consequence.
 *
 * Until this existed, `warnings` drove a bare triangle glyph with no title and no
 * `aria-label`, so a planner could see that SOMETHING was wrong and had no way to learn
 * what — and a screen reader saw nothing at all.
 */
export function useCapacityWarningText() {
  const { t } = useTranslation('capacity')

  return useCallback(
    (warnings: readonly CapacityWarning[]): string[] =>
      warnings.map((code) => t(`warnings.${code}`)),
    [t],
  )
}
