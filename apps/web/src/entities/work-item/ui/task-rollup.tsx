/**
 * `<TaskRollup>` — read-only aggregate of a work item's child-task hours
 * (Estimate / To Do / Actual), rendered as a compact 3-cell grid (Broadcom
 * Rally parity). Lives in the work-item entity so backlog cards and the detail
 * sidebar render the roll-up identically.
 */

interface TaskRollupProps {
  estimate: number
  todo: number
  actual: number
}

const CELLS = [
  { label: 'Estimate', key: 'estimate' },
  { label: 'To Do', key: 'todo' },
  { label: 'Actual', key: 'actual' },
] as const

export function TaskRollup({ estimate, todo, actual }: TaskRollupProps) {
  const values = { estimate, todo, actual }
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded border border-avatar">
      {CELLS.map(({ label, key }, i) => (
        <div
          key={key}
          className={`px-2 py-1.5 text-center bg-surface-hover${i === 0 ? '' : 'border-l border-avatar'}`}
        >
          <div className="text-ui-2xs font-semibold tracking-wide text-foreground-subtle uppercase">
            {label}
          </div>
          <div className="text-ui-lg font-semibold text-foreground tabular-nums">{values[key]}</div>
        </div>
      ))}
    </div>
  )
}
