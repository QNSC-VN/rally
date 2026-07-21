import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { useUpdateRelease, type Release, type ReleaseStatus } from '@/features/releases/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { InlineSelect } from '@/shared/ui/native-select'
import { RELEASE_STATES, RELEASE_STATUS_STYLE } from '../model/release-states'

// ── Edit modal (Release Detail) ──────────────────────────────────────────

export function ReleaseDetailModal({
  release,
  projectId,
  onClose,
}: {
  release: Release
  projectId: string
  onClose: () => void
}) {
  const [name, setName] = useState(release.name)
  const [theme, setTheme] = useState(release.theme ?? '')
  const [notes, setNotes] = useState(release.notes ?? '')
  const [startDate, setStartDate] = useState(release.startDate ?? '')
  const [releaseDate, setReleaseDate] = useState(release.releaseDate ?? '')
  const [plannedVelocity, setPlannedVelocity] = useState(
    release.plannedVelocity == null ? '' : String(release.plannedVelocity),
  )
  const [planEstimate, setPlanEstimate] = useState(
    release.planEstimate == null ? '' : String(release.planEstimate),
  )
  const [version, setVersion] = useState(release.version ?? '')
  const [state, setState] = useState<ReleaseStatus>(release.status)
  const update = useUpdateRelease(release.id, projectId)

  async function handleSubmit() {
    if (!name.trim()) return
    try {
      await update.mutateAsync({
        name: name.trim(),
        theme: theme.trim() || null,
        notes: notes.trim() || null,
        startDate: startDate || null,
        releaseDate: releaseDate || null,
        plannedVelocity: plannedVelocity ? Number(plannedVelocity) : null,
        planEstimate: planEstimate ? Number(planEstimate) : null,
        version: version.trim() || null,
        state,
      })
      notify.success('Release updated')
      onClose()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to update release')
    }
  }

  const rollup = release.taskRollup

  return (
    <AppModal open onClose={onClose} title={release.name} subtitle="Release Detail" width={560}>
      <ModalBody className="space-y-4">
        {/* Task Rollup Summary */}
        {rollup && (
          <div className="flex items-center gap-4 rounded-md border border-border-subtle bg-surface-hover p-3">
            <div className="flex-1">
              <div className="mb-1 text-ui-xs font-semibold tracking-wider text-foreground-subtle uppercase">
                Progress
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-border-subtle">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${rollup.progressPercent}%`,
                      backgroundColor:
                        rollup.progressPercent === 100
                          ? BRAND.success
                          : rollup.progressPercent > 50
                            ? BRAND.primaryLight
                            : BRAND.warning,
                    }}
                  />
                </div>
                <span className="font-mono text-ui-sm font-semibold text-foreground">
                  {rollup.progressPercent}%
                </span>
              </div>
            </div>
            <div className="border-l border-border-subtle px-3 text-center">
              <div className="text-ui-xs tracking-wider text-foreground-subtle uppercase">
                Items
              </div>
              <div className="font-mono text-ui-xl font-semibold text-foreground">
                {rollup.completedItems}
                <span className="text-ui-sm font-normal text-foreground-subtle">
                  /{rollup.totalItems}
                </span>
              </div>
            </div>
            <div className="border-l border-border-subtle px-3 text-center">
              <div className="text-ui-xs tracking-wider text-foreground-subtle uppercase">
                Points
              </div>
              <div className="font-mono text-ui-xl font-semibold text-foreground">
                {rollup.completedPoints}
                <span className="text-ui-sm font-normal text-foreground-subtle">
                  /{rollup.totalPoints}
                </span>
              </div>
            </div>
          </div>
        )}
        {/* Left panel fields: Theme, Notes */}
        <FormField label="Theme">
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Release theme or goal..."
            rows={3}
          />
        </FormField>

        <FormField label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes..."
            rows={3}
          />
        </FormField>

        {/* Right panel fields */}
        <FormField label="Release name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <div className="flex gap-3">
          <FormField label="Start Date" className="flex-1">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="Release Date" className="flex-1">
            <Input
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="State">
          <InlineSelect
            value={state}
            onChange={(e) => setState(e.target.value as ReleaseStatus)}
            className="w-full rounded border border-input bg-card px-2 py-1.5 text-ui-sm text-foreground focus:outline-none"
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>
                {RELEASE_STATUS_STYLE[s].label}
              </option>
            ))}
          </InlineSelect>
        </FormField>

        <div className="flex gap-3">
          <FormField label="Planned Velocity" className="flex-1">
            <Input
              type="number"
              min={0}
              value={plannedVelocity}
              onChange={(e) => setPlannedVelocity(e.target.value)}
              placeholder="0"
            />
          </FormField>
          <FormField label="Plan Estimate" className="flex-1">
            <Input
              type="number"
              min={0}
              value={planEstimate}
              onChange={(e) => setPlanEstimate(e.target.value)}
              placeholder="0"
            />
          </FormField>
        </div>

        <FormField label="Version" hint="Optional">
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={update.isPending || !name.trim()}
          onClick={() => {
            void handleSubmit()
          }}
        >
          {update.isPending && <Loader2 size={11} className="animate-spin" />}
          Save
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
