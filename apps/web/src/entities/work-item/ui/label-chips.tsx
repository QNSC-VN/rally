/**
 * `<LabelChips>` — renders a work-item's labels (Tags) as coloured pills.
 * Kept in the work-item entity so Backlog rows, cards, and the detail sidebar
 * all render labels identically. Accepts a minimal structural shape so it stays
 * decoupled from any feature-layer response type.
 */

export interface LabelChip {
  id: string
  name: string
  color: string
}

export function LabelChips({ labels }: { labels: readonly LabelChip[] }) {
  if (labels.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l) => (
        <span
          key={l.id}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-ui-sm font-medium"
          style={{
            backgroundColor: `${l.color}1a`,
            color: l.color,
            border: `1px solid ${l.color}55`,
          }}
        >
          {l.name}
        </span>
      ))}
    </div>
  )
}
