/**
 * Revision History — a failed read must not say the entity has no history.
 *
 * This one component is the Revision History tab on FIVE detail pages (work item, iteration,
 * release, milestone, portfolio item, project). Its props were `logs: ActivityRow[]` + `isLoading`,
 * so there was no way to express failure and every page passed `data ?? []` — a 403 or a 500
 * rendered "No revisions yet.", a statement about the record's audit trail drawn from a request
 * that never landed. Five surfaces, one prop shape.
 *
 * NEGATIVE assertions are the point here: `queryByText` for the empty sentence, not just a
 * `getByRole('alert')`. A test that only checks the error appeared would still pass if the empty
 * state appeared BESIDE it — which is exactly what Team Capacity shipped (four `0h` cards directly
 * above their own error message).
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { listResource } from '@/shared/lib/query/resource'
import { ActivityHistoryTab } from './activity-history-tab'

const ROW = {
  id: 'a-1',
  createdAt: '2026-08-01T10:00:00.000Z',
  actorId: 'u-1',
  actorName: 'Marcus Webb',
  action: 'work_item.created',
  field: null,
  oldValue: null,
  newValue: null,
  changes: null,
}

/**
 * A state change, as the API reports it for each entity (GAP-P1-HIST-002).
 *
 * `changes.field` is `scheduleState` on BOTH — it is the DTO/wire field name, mirrored onto
 * `work.tasks.state` — and the ACTION is what distinguishes them (`activity-diff.ts`). The renderer
 * used to humanise the field name alone and consult `action` only when `changes` was null, so a
 * Task's state change was labelled "Schedule State": a dimension a Task does not have.
 */
function stateChangeRow(id: string, action: string) {
  return {
    ...ROW,
    id,
    action,
    changes: { field: 'scheduleState', old: 'Defined', new: 'In-Progress' },
  }
}

function renderTab(q: Parameters<typeof listResource>[0]) {
  return render(
    <ActivityHistoryTab
      logs={listResource(q as { data: (typeof ROW)[] | undefined })}
      title="Revision History"
      subtitle="Every change, newest first."
    />,
  )
}

describe('ActivityHistoryTab', () => {
  it('renders an ERROR and NOT "No revisions yet." when the activity query failed', () => {
    renderTab({ data: undefined, isError: true, error: new Error('403 forbidden') })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // The load failure must be stated as a load failure.
    expect(screen.getByText('Could not load this data.')).toBeInTheDocument()
    // And the fabricated fact must be absent — not merely accompanied.
    expect(screen.queryByText('No revisions yet.')).not.toBeInTheDocument()
  })

  it('renders "No revisions yet." when the server really answered with nothing', () => {
    renderTab({ data: [], isLoading: false })

    expect(screen.getByText('No revisions yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders neither state while the request is in flight', () => {
    renderTab({ data: undefined, isLoading: true })

    expect(screen.queryByText('No revisions yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the rows when there are rows', () => {
    renderTab({ data: [ROW], isLoading: false })

    expect(screen.getByText('Marcus Webb')).toBeInTheDocument()
    expect(screen.queryByText('No revisions yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('labels a TASK state change "Task State", never "Schedule State"', () => {
    renderTab({ data: [stateChangeRow('a-2', 'task.state_changed')], isLoading: false })

    expect(screen.getByText('Task State changed from Defined to In-Progress')).toBeInTheDocument()
    // The negative is the defect: the field name alone humanises to this, and it names a dimension
    // a Task does not have. Asserting only the positive would pass if both were rendered.
    expect(screen.queryByText(/Schedule State/)).not.toBeInTheDocument()
  })

  it('still labels a WORK ITEM state change "Schedule State" (the field is shared)', () => {
    // The discriminant is the action, not the field — a per-field rename would have relabelled this
    // row too, and Schedule State is exactly what a work item has.
    renderTab({
      data: [stateChangeRow('a-3', 'work_item.schedule_state_changed')],
      isLoading: false,
    })

    expect(
      screen.getByText('Schedule State changed from Defined to In-Progress'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Task State/)).not.toBeInTheDocument()
  })

  it('keeps both labels straight when the two rows sit in one feed', () => {
    renderTab({
      data: [
        stateChangeRow('a-2', 'task.state_changed'),
        stateChangeRow('a-3', 'work_item.schedule_state_changed'),
      ],
      isLoading: false,
    })

    expect(screen.getByText('Task State changed from Defined to In-Progress')).toBeInTheDocument()
    expect(
      screen.getByText('Schedule State changed from Defined to In-Progress'),
    ).toBeInTheDocument()
  })
})
