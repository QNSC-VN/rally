import { useState } from 'react'
import { Plus, ChevronUp, ChevronDown, Trash2, Loader2 } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'
import { PERMISSION } from '@/shared/config/permissions'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import {
  useProjectStatuses,
  useCreateStatus,
  useDeleteStatus,
  useReorderStatuses,
  type ProjectStatus,
} from '@/features/projects/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { EmptyState } from '@/shared/ui/empty-state'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { Spinner } from '@/shared/ui/spinner'

const STATUS_CATEGORIES = [
  { value: 'to_do', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
] as const

type StatusCategory = (typeof STATUS_CATEGORIES)[number]['value']

/** Token classes for a workflow-status category badge. */
function statusCategoryClass(category: StatusCategory): string {
  switch (category) {
    case 'in_progress':
      return 'bg-warning-bg text-warning'
    case 'done':
      return 'bg-success-bg text-success'
    case 'to_do':
    default:
      return 'bg-surface-subtle text-muted-foreground'
  }
}

function categoryLabel(category: string): string {
  return STATUS_CATEGORIES.find((c) => c.value === category)?.label ?? category
}

function AddStatusModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<StatusCategory>('to_do')
  const [color, setColor] = useState<string>(BRAND.statusDefault)
  const create = useCreateStatus(projectId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await create.mutateAsync({ name: name.trim(), category, color })
      notify.success(`Status "${name.trim()}" added`)
      onClose()
    } catch (err) {
      notify.fromError(err, 'Failed to add status')
    }
  }

  return (
    <AppModal open onClose={onClose} title="Add Status" width={420}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalBody className="space-y-4">
          <FormField label="Status name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="In Review"
              autoFocus
            />
          </FormField>
          <FormField label="Category" required>
            <NativeSelect
              value={category}
              onChange={(e) => setCategory(e.target.value as StatusCategory)}
            >
              {STATUS_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Colour">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded-md border bg-white p-1"
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending && <Loader2 size={12} className="animate-spin" />}
            Add Status
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

export function WorkflowTab() {
  const activeProject = useAppContext((s) => s.project)
  const { hasPermission } = useAuthStore()
  const canManage = hasPermission(PERMISSION.PROJECT_EDIT)
  const projectId = activeProject?.projectId

  const { data: statuses = [], isLoading, isError } = useProjectStatuses(projectId)
  const reorder = useReorderStatuses(projectId)
  const remove = useDeleteStatus(projectId)
  const [showAdd, setShowAdd] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectStatus | null>(null)

  if (!activeProject) {
    return (
      <p className="text-ui-lg text-foreground-subtle">
        No project selected. Navigate into a project first.
      </p>
    )
  }

  const ordered = [...statuses].sort((a, b) => a.position - b.position)

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const ids = ordered.map((s) => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await reorder.mutateAsync(ids)
    } catch (err) {
      notify.fromError(err, 'Failed to reorder statuses')
    }
  }

  async function handleDelete(status: ProjectStatus) {
    try {
      await remove.mutateAsync(status.id)
      notify.success(`Status "${status.name}" deleted`)
      setDeleteTarget(null)
    } catch (err) {
      notify.fromError(err, 'Failed to delete status')
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-ui-lg text-muted-foreground">
          Define the statuses work items move through in{' '}
          <span className="font-semibold text-foreground">{activeProject.projectKey}</span>.
        </p>
        {canManage && (
          <Button variant="secondary" size="sm" type="button" onClick={() => setShowAdd(true)}>
            <Plus size={13} /> Add Status
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : isError ? (
        <EmptyState title="Unable to load statuses. Please try again." />
      ) : ordered.length === 0 ? (
        <EmptyState title="No statuses defined yet." />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <div className="flex items-center gap-2 bg-surface-hover px-3 py-2 text-ui-xs font-semibold tracking-wider text-foreground-subtle uppercase">
            <div className="flex-1">Status Name</div>
            <div className="w-28">Category</div>
            <div className="w-16 text-center">Default</div>
            <div className="w-24 text-right">Actions</div>
          </div>
          {ordered.map((status, index) => (
            <div
              key={status.id}
              className="flex items-center gap-2 border-t border-border-inner px-3 py-2.5"
            >
              <div className="flex flex-1 items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: status.color ?? BRAND.textMuted }}
                />
                <span className="text-ui-lg font-medium text-foreground">{status.name}</span>
              </div>
              <div className="w-28">
                <span
                  className={cn(
                    'rounded px-2 py-0.5 text-ui-xs font-semibold',
                    statusCategoryClass(status.category as StatusCategory),
                  )}
                >
                  {categoryLabel(status.category)}
                </span>
              </div>
              <div className="w-16 text-center">
                {status.isDefault && (
                  <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-ui-2xs font-medium tracking-wide text-muted-foreground uppercase">
                    Default
                  </span>
                )}
              </div>
              <div className="flex w-24 items-center justify-end gap-0.5">
                {canManage && (
                  <>
                    <IconButton
                      type="button"
                      size="sm"
                      aria-label="Move up"
                      title="Move up"
                      onClick={() => void move(index, -1)}
                      disabled={index === 0 || reorder.isPending}
                    >
                      <ChevronUp size={14} />
                    </IconButton>
                    <IconButton
                      type="button"
                      size="sm"
                      aria-label="Move down"
                      title="Move down"
                      onClick={() => void move(index, 1)}
                      disabled={index === ordered.length - 1 || reorder.isPending}
                    >
                      <ChevronDown size={14} />
                    </IconButton>
                    <IconButton
                      type="button"
                      size="sm"
                      variant="destructive"
                      aria-label="Delete status"
                      title="Delete status"
                      onClick={() => setDeleteTarget(status)}
                      disabled={remove.isPending}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && projectId && (
        <AddStatusModal projectId={projectId} onClose={() => setShowAdd(false)} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete status"
        confirmText={deleteTarget?.name ?? ''}
        message="Work items in this status must be moved elsewhere first. This cannot be undone."
        confirmLabel="Delete status"
        pending={remove.isPending}
        onConfirm={() => deleteTarget && void handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
