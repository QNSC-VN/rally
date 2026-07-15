import { WorkItemType } from '@/entities/work-item/model/types'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'

interface FeatureCellProps {
  /** Parent feature key, e.g. `FE000001`. */
  featureKey: string
  /** Feature title; when present it is appended as `KEY: Title` (Rally parity). */
  featureTitle?: string | null
  /** Open the feature (navigation is owned by the caller). */
  onOpen: () => void
}

/**
 * Feature column cell — a purple feature glyph followed by `KEY: Title`. Thin
 * wrapper over the shared {@link WorkItemRefCell} so the Feature column renders
 * identically on Backlog, Iteration Status, and any future board.
 */
export function FeatureCell({ featureKey, featureTitle, onOpen }: FeatureCellProps) {
  return (
    <WorkItemRefCell
      type={WorkItemType.Feature}
      itemKey={featureKey}
      title={featureTitle}
      onOpen={onOpen}
    />
  )
}
