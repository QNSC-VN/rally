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
    <div
      className="grid grid-cols-3 overflow-hidden rounded"
      style={{ border: '1px solid #e2e8f0' }}
    >
      {CELLS.map(({ label, key }, i) => (
        <div
          key={key}
          className="px-2 py-1.5 text-center"
          style={{
            backgroundColor: '#f8fafc',
            borderLeft: i === 0 ? undefined : '1px solid #e2e8f0',
          }}
        >
          <div
            className="text-[9px] font-semibold tracking-wide uppercase"
            style={{ color: '#8c94a6' }}
          >
            {label}
          </div>
          <div className="text-[13px] font-semibold tabular-nums" style={{ color: '#273449' }}>
            {values[key]}
          </div>
        </div>
      ))}
    </div>
  )
}
