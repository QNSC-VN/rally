import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjects, useUpdateProject } from '@/features/projects/api'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

// ── Project Settings tab ──────────────────────────────────────────────────────

export function ProjectSettingsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const activeProject = useAppContext((s) => s.project)
  const setProject = useAppContext((s) => s.setProject)
  const { data: projects = [] } = useProjects(workspaceId)
  const current = projects.find((p) => p.id === activeProject?.projectId)
  const update = useUpdateProject(workspaceId)

  const [name, setName] = useState(current?.name ?? activeProject?.projectName ?? '')
  const [description, setDescription] = useState(current?.description ?? '')

  // Sync form when project data loads or the active project switches.
  // Tracking current.id avoids resetting mid-edit on background refetches
  // while still resetting correctly when the user picks a different project.
  const [syncedId, setSyncedId] = useState(current?.id)
  if (current && current.id !== syncedId) {
    setSyncedId(current.id)
    setName(current.name)
    setDescription(current.description ?? '')
  }

  if (!activeProject) {
    return (
      <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
        No project selected. Navigate into a project first.
      </p>
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeProject || !name.trim()) return
    try {
      await update.mutateAsync({ id: activeProject.projectId, input: { name: name.trim(), description: description.trim() || undefined } })
      setProject({ projectId: activeProject.projectId, projectKey: activeProject.projectKey, projectName: name.trim() })
      toast.success('Project settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <form onSubmit={(e) => { void handleSave(e) }} className="max-w-lg space-y-5">
      <div className="mb-2 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: BRAND.surface, border: `1px solid ${BRAND.border}`, color: BRAND.textMuted }}>
        Project: <span className="font-semibold" style={{ color: BRAND.textPrimary }}>{activeProject.projectKey} — {activeProject.projectName}</span>
      </div>
      <FormField label="Project name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
      </FormField>
      <FormField label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this project deliver?"
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
