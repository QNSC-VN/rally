import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useWorkspaces, useUpdateWorkspace } from '@/features/workspaces/api'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

// ── Workspace Settings tab ────────────────────────────────────────────────────

export function WorkspaceSettingsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const setWorkspace = useAppContext((s) => s.setWorkspace)
  const workspace = useAppContext((s) => s.workspace)
  const { data: workspaces = [] } = useWorkspaces()
  const current = workspaces.find((w) => w.id === workspaceId)
  const update = useUpdateWorkspace(workspaceId)

  const [name, setName] = useState(current?.name ?? workspace?.workspaceName ?? '')
  const [description, setDescription] = useState(current?.description ?? '')

  // Sync form once when workspace data first loads (current.id becomes defined).
  // Tracking the id (not the object) avoids resetting mid-edit on background refetches.
  const [syncedId, setSyncedId] = useState(current?.id)
  if (current && current.id !== syncedId) {
    setSyncedId(current.id)
    setName(current.name)
    setDescription(current.description ?? '')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !name.trim()) return
    try {
      const updated = await update.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
      })
      setWorkspace({ workspaceId, workspaceSlug: workspace?.workspaceSlug ?? '', workspaceName: updated.name })
      toast.success('Workspace settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <form onSubmit={(e) => { void handleSave(e) }} className="max-w-lg space-y-5">
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
        <button
          type="submit"
          disabled={update.isPending || !name.trim()}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: BRAND.primary }}
        >
          {update.isPending && <Loader2 size={12} className="animate-spin" />}
          Save changes
        </button>
      </div>
    </form>
  )
}
