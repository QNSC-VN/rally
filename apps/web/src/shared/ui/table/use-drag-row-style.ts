import { useMemo, type CSSProperties } from 'react'
import { CSS } from '@dnd-kit/utilities'
import type { Transform } from '@dnd-kit/utilities'

import { BRAND } from '@/shared/config/brand'

/**
 * The inline style a drag-to-rank row needs, in one place.
 *
 * Seven grids had hand-written the same block — `CSS.Transform.toString(transform)`, the
 * transition, a lifted `zIndex`/`position` so the dragged row is not clipped by its neighbours,
 * and a highlight fill — and they had already drifted: opacity is 0.5 in three of them and 0.6 in
 * another, and only some remember `position: 'relative'`, without which `zIndex` does nothing on a
 * statically-positioned element and the row still clips.
 *
 * It stays an inline STYLE rather than becoming a class because it genuinely is dynamic: the
 * transform is recomputed per pointer move. That is also why the consumer-layer inline-style
 * ratchet is the wrong place to fight it — the fix is one shared producer, not seven suppressed
 * call sites.
 *
 * @param transform dnd-kit's live transform, or null when the row is at rest.
 * @param transition dnd-kit's transition string.
 * @param isDragging whether this row is the one under the pointer.
 * @param highlight optional resting background (e.g. a "you were sent here" reveal). A drag
 *   always wins: while dragging, that is what the row is doing.
 */
export function useDragRowStyle({
  transform,
  transition,
  isDragging,
  highlight,
}: {
  transform: Transform | null
  transition?: string
  isDragging: boolean
  highlight?: string
}): CSSProperties {
  return useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      backgroundColor: isDragging ? BRAND.primaryLighter : highlight,
      zIndex: isDragging ? 1 : undefined,
      // Required for `zIndex` to apply at all — a static element ignores it, so a dragged row
      // without this still slides under the rows below it.
      position: isDragging ? 'relative' : undefined,
    }),
    [transform, transition, isDragging, highlight],
  )
}
