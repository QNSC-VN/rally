/**
 * Settings ▸ Integrations — SCM repository → project mappings. A repo's webhook
 * events (PRs/commits) are linked to work items only in the project(s) mapped
 * here (the SCMRepository analog). Also surfaces the webhook URL to configure on
 * the GitHub side.
 */
import { useMemo, useState } from 'react'
import { Trash2, Loader2, Plug, RefreshCw } from 'lucide-react'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjects } from '@/features/projects/api'
import {
  useScmRepositories,
  useCreateScmRepository,
  useDeleteScmRepository,
  useSyncScmRepository,
  type ScmProvider,
} from '@/features/scm/api'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { EmptyState } from '@/shared/ui/empty-state'

export function IntegrationsTab() {
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId
  const { data: repos = [], isLoading } = useScmRepositories(workspaceId)
  const { data: projects = [] } = useProjects(workspaceId)
  const createRepo = useCreateScmRepository(workspaceId)
  const deleteRepo = useDeleteScmRepository(workspaceId)
  const syncRepo = useSyncScmRepository(workspaceId)

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  const [provider, setProvider] = useState<ScmProvider>('github')
  const [fullName, setFullName] = useState('')
  const [projectIds, setProjectIds] = useState<string[]>([])

  const webhookUrl = `${window.location.origin}/v1/scm/webhook/${provider}`

  function toggleProject(id: string) {
    setProjectIds((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]))
  }

  async function add() {
    if (!fullName.trim() || projectIds.length === 0) {
      notify.error('Enter a repository (owner/name) and select at least one project.')
      return
    }
    try {
      await createRepo.mutateAsync({ provider, fullName: fullName.trim(), projectIds })
      notify.success(`Linked ${fullName.trim()}`)
      setFullName('')
      setProjectIds([])
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Failed to add repository')
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Existing mappings */}
      <section>
        <h3 className="mb-2 text-ui-md font-semibold text-foreground">Connected repositories</h3>
        {isLoading ? (
          <p className="text-ui-sm text-foreground-subtle">Loading…</p>
        ) : repos.length === 0 ? (
          <EmptyState
            icon={<Plug size={22} className="text-border-strong" />}
            title="No repositories connected"
            description="Map a repository to a project below, then add the webhook to GitHub."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full border-collapse text-ui-sm">
              <thead className="bg-surface-subtle">
                <tr className="text-left text-ui-xs text-foreground-subtle">
                  <th className="px-3 py-2 font-semibold">Repository</th>
                  <th className="px-3 py-2 font-semibold">Provider</th>
                  <th className="px-3 py-2 font-semibold">Projects</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {repos.map((r) => (
                  <tr key={r.id} className="border-t border-border-inner">
                    <td className="px-3 py-2 font-mono text-foreground">{r.fullName}</td>
                    <td className="px-3 py-2 text-muted-foreground uppercase">{r.provider}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.projectIds.map((id) => projectName.get(id) ?? id).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        aria-label={`Sync ${r.fullName}`}
                        title="Sync now — backfill existing PRs & commits"
                        className="mr-3 text-foreground-subtle hover:text-foreground disabled:opacity-50"
                        disabled={syncRepo.isPending && syncRepo.variables === r.id}
                        onClick={() => {
                          void syncRepo
                            .mutateAsync(r.id)
                            .then(() => notify.success(`Sync queued for ${r.fullName}`))
                            .catch((e: unknown) =>
                              notify.error(e instanceof Error ? e.message : 'Failed to sync'),
                            )
                        }}
                      >
                        <RefreshCw
                          size={14}
                          className={
                            syncRepo.isPending && syncRepo.variables === r.id ? 'animate-spin' : ''
                          }
                        />
                      </button>
                      <button
                        aria-label={`Remove ${r.fullName}`}
                        className="text-foreground-subtle hover:text-destructive"
                        onClick={() => {
                          void deleteRepo
                            .mutateAsync(r.id)
                            .then(() => notify.success(`Removed ${r.fullName}`))
                            .catch((e: unknown) =>
                              notify.error(e instanceof Error ? e.message : 'Failed to remove'),
                            )
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add mapping */}
      <section className="space-y-3">
        <h3 className="text-ui-md font-semibold text-foreground">Connect a repository</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-ui-xs text-foreground-subtle">Provider</span>
            <NativeSelect
              value={provider}
              onChange={(e) => setProvider(e.target.value as ScmProvider)}
            >
              <option value="github">GitHub.com</option>
              <option value="ghe">GitHub Enterprise</option>
            </NativeSelect>
          </label>
          <label className="flex flex-1 flex-col gap-1" style={{ minWidth: 220 }}>
            <span className="text-ui-xs text-foreground-subtle">Repository (owner/name)</span>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="owner/repo"
            />
          </label>
          <Button type="button" onClick={() => void add()} disabled={createRepo.isPending}>
            {createRepo.isPending && <Loader2 size={12} className="animate-spin" />}
            Add
          </Button>
        </div>

        <div>
          <span className="text-ui-xs text-foreground-subtle">Projects it references</span>
          <div className="mt-1 grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded border border-input bg-input-background p-2">
            {projects.length === 0 ? (
              <span className="text-ui-sm text-foreground-subtle">No projects</span>
            ) : (
              projects.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-ui-md text-foreground">
                  <input
                    type="checkbox"
                    checked={projectIds.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <p className="text-ui-xs text-foreground-subtle">
          Add this webhook URL to the repository (content type <code>application/json</code>,
          events: Pull requests + Pushes), using the shared secret from your SCM integration
          settings:
          <br />
          <code className="mt-1 inline-block rounded bg-surface-subtle px-2 py-1 font-mono text-foreground">
            {webhookUrl}
          </code>
        </p>
      </section>
    </div>
  )
}
