import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useWorkspaces, useUpdateWorkspace, useWorkspaceMembers } from '@/features/workspaces/api'
import { useResetOnIdChange } from '@/shared/lib/hooks/use-reset-on-id-change'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

export function WorkspaceSettingsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const setWorkspace = useAppContext((s) => s.setWorkspace)
  const workspace = useAppContext((s) => s.workspace)
  const { data: workspaces = [] } = useWorkspaces()
  const current = workspaces.find((w) => w.id === workspaceId)
  const update = useUpdateWorkspace(workspaceId)

  // Read-only workspace admins, derived from the shared members-with-profile roster.
  const { data: allMembers = [] } = useWorkspaceMembers(workspaceId)
  const admins = allMembers.filter((m) => m.roleSlug === 'workspace_admin')

  const [name, setName] = useState(current?.name ?? workspace?.workspaceName ?? '')
  const [description, setDescription] = useState(current?.description ?? '')

  useResetOnIdChange(current?.id, () => {
    setName(current!.name)
    setDescription(current!.description ?? '')
  })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !name.trim()) return
    try {
      const updated = await update.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
      })
      setWorkspace({
        workspaceId,
        workspaceSlug: workspace?.workspaceSlug ?? '',
        workspaceName: updated.name,
      })
      notify.success('Workspace settings saved')
    } catch (err) {
      notify.fromError(err, 'Failed to save')
    }
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="max-w-lg space-y-5">
      {/* ── Read-only identity ── */}
      <div className="rounded-md border">
        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2.5 p-4 text-ui-lg">
          <dt className="text-foreground-subtle">Slug</dt>
          <dd className="font-mono text-foreground">
            {current?.slug ?? workspace?.workspaceSlug ?? '—'}
          </dd>
          <dt className="text-foreground-subtle">Workspace admin</dt>
          <dd className="text-foreground">
            {admins.length === 0 ? '—' : admins.map((a) => a.displayName).join(', ')}
          </dd>
        </dl>
      </div>

      <FormField label="Workspace name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
      </FormField>
      <FormField label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this workspace cover?"
          rows={3}
        />
      </FormField>
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={update.isPending || !name.trim()}>
          {update.isPending && <Loader2 size={12} className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  )
}
