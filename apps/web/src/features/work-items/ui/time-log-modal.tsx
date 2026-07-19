/**
 * TimeLogModal — Jira-style worklog for a work item.
 *
 * `work_items.actual_hours` is trigger-derived from the SUM of these entries
 * (trg_sync_actual_hours), so this modal is the single source of truth for a
 * task's Actual hours. Any authenticated project member can log time; entries
 * can be deleted by their owner (the backend also permits admins).
 */
import { useMemo, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTimeLogs, useLogTime, useDeleteTimeLog, type TimeLog } from '@/features/work-items/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Spinner } from '@/shared/ui/spinner'
import { BRAND } from '@/shared/config/brand'

interface Props {
  workItemId: string
  /** Resolves a userId to a display name for the "Logged by" column. */
  memberName: (userId: string) => string
  /** When false, the add form and delete actions are hidden (read-only view). */
  canEdit: boolean
  onClose: () => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function TimeLogModal({ workItemId, memberName, canEdit, onClose }: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id)
  const { data: logs = [], isLoading } = useTimeLogs(workItemId)
  const logTime = useLogTime(workItemId)
  const deleteLog = useDeleteTimeLog(workItemId)

  const [loggedDate, setLoggedDate] = useState(today)
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const total = useMemo(() => logs.reduce((sum, l) => sum + l.hours, 0), [logs])

  async function submit() {
    const num = Number(hours)
    if (!loggedDate) {
      setError('Date is required.')
      return
    }
    if (!hours || Number.isNaN(num) || num <= 0 || num > 24) {
      setError('Hours must be a positive number up to 24.')
      return
    }
    setError(null)
    try {
      await logTime.mutateAsync({
        loggedDate,
        hours: num,
        description: description.trim() || undefined,
      })
      setHours('')
      setDescription('')
      setLoggedDate(today())
      toast.success('Time logged')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log time.')
    }
  }

  async function remove(log: TimeLog) {
    try {
      await deleteLog.mutateAsync(log.id)
      toast.success('Time log removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove time log.')
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title="Time Logs"
      subtitle="Actual hours are the sum of these entries."
      width={560}
    >
      <ModalBody>
        {canEdit && (
          <div
            className="mb-4 grid items-end gap-2"
            style={{ gridTemplateColumns: '150px 90px 1fr auto' }}
          >
            <FormField label="Date">
              <Input
                type="date"
                value={loggedDate}
                max={today()}
                onChange={(e) => setLoggedDate(e.target.value)}
              />
            </FormField>
            <FormField label="Hours">
              <Input
                type="number"
                min={0}
                max={24}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0"
              />
            </FormField>
            <FormField label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What did you work on? (optional)"
              />
            </FormField>
            <Button size="sm" onClick={submit} disabled={logTime.isPending}>
              {logTime.isPending && <Loader2 size={13} className="animate-spin" />}
              Log
            </Button>
          </div>
        )}

        {error && (
          <p className="mb-3 text-[12px]" style={{ color: BRAND.danger }}>
            {error}
          </p>
        )}

        {isLoading ? (
          <div className="flex h-20 items-center justify-center">
            <Spinner />
          </div>
        ) : logs.length === 0 ? (
          <p className="py-6 text-center text-[12px]" style={{ color: BRAND.textMuted }}>
            No time logged yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded" style={{ border: `1px solid ${BRAND.border}` }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr
                  className="text-left"
                  style={{
                    backgroundColor: BRAND.surfaceHover,
                    color: BRAND.textSecondary,
                    borderBottom: `1px solid ${BRAND.border}`,
                  }}
                >
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 text-right font-semibold">Hours</th>
                  <th className="px-3 py-2 font-semibold">Logged by</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
                    className="align-top"
                  >
                    <td className="px-3 py-2 font-mono" style={{ color: BRAND.textSecondary }}>
                      {log.loggedDate}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{log.hours}h</td>
                    <td className="px-3 py-2" style={{ color: BRAND.textSecondary }}>
                      {memberName(log.userId)}
                    </td>
                    <td className="px-3 py-2">{log.description ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && log.userId === currentUserId && (
                        <button
                          aria-label="Delete time log"
                          onClick={() => void remove(log)}
                          disabled={deleteLog.isPending}
                          className="rounded p-1 transition-colors hover:bg-red-50 disabled:opacity-50"
                          style={{ color: BRAND.danger }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: BRAND.surfaceSubtle }}>
                  <td className="px-3 py-2 font-semibold" style={{ color: BRAND.textPrimary }}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{total}h</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
