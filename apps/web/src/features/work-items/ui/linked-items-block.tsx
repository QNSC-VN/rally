/**
 * LinkedItemsBlock — F6 work-item relations panel for the Work Item Detail page.
 *
 * Shows every linked item grouped by relation label (Blocks / Blocked by /
 * Relates to / …), lets an editor add a link (pick relation type + search a
 * target work item in the same project) and remove existing links.
 * Mirrors the AttachmentBlock layout/readOnly conventions.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Link2, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { type WorkItemType } from '@/entities/work-item/model/types'
import {
  useRelations,
  useLinkWorkItem,
  useUnlinkWorkItem,
  type WorkItemRelationType,
  type WorkItemRelationView,
} from '@/features/work-items/api'

// Selectable relation types (outbound direction, human labels).
const RELATION_TYPE_OPTIONS: { value: WorkItemRelationType; label: string }[] = [
  { value: 'blocks', label: 'Blocks' },
  { value: 'depends_on', label: 'Depends on' },
  { value: 'relates_to', label: 'Relates to' },
  { value: 'duplicates', label: 'Duplicates' },
]

interface SearchHit {
  id: string
  itemKey: string
  title: string
}

interface LinkedItemsBlockProps {
  workItemId: string | undefined
  projectId: string | undefined
  readOnly?: boolean
}

export function LinkedItemsBlock({
  workItemId,
  projectId,
  readOnly = false,
}: LinkedItemsBlockProps) {
  const navigate = useNavigate()
  const { data: relations = [], isLoading } = useRelations(workItemId)
  const linkMutation = useLinkWorkItem(workItemId)
  const unlinkMutation = useUnlinkWorkItem(workItemId)

  const [adding, setAdding] = useState(false)
  const [relationType, setRelationType] = useState<WorkItemRelationType>('relates_to')
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [error, setError] = useState<string | null>(null)

  // Group relations by their (side-resolved) label for display.
  const grouped = useMemo(() => {
    const map = new Map<string, WorkItemRelationView[]>()
    for (const r of relations) {
      const list = map.get(r.label) ?? []
      list.push(r)
      map.set(r.label, list)
    }
    return [...map.entries()]
  }, [relations])

  async function runSearch(q: string) {
    setSearch(q)
    if (!projectId || q.trim().length < 2) {
      setHits([])
      return
    }
    const params = new URLSearchParams({ projectId, q: q.trim(), limit: '8' })
    const res = await fetch(`/v1/work-items?${params.toString()}`, { credentials: 'include' })
    if (!res.ok) return
    const body = (await res.json()) as { data?: SearchHit[] }
    setHits((body.data ?? []).filter((h) => h.id !== workItemId))
  }

  async function addLink(targetId: string) {
    setError(null)
    try {
      await linkMutation.mutateAsync({ targetId, relationType })
      setAdding(false)
      setSearch('')
      setHits([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link item')
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-ui-md font-semibold text-muted-foreground">
          <Link2 size={13} />
          Linked Items
          {relations.length > 0 && (
            <span className="text-foreground-subtle">({relations.length})</span>
          )}
        </div>
        {!readOnly && !adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus size={12} />
            Link item
          </Button>
        )}
      </div>

      {adding && (
        <div className="mb-3 rounded border border-input p-2">
          <div className="flex items-center justify-between gap-2">
            <NativeSelect
              value={relationType}
              onChange={(e) => setRelationType(e.target.value as WorkItemRelationType)}
              className="w-auto"
            >
              {RELATION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <IconButton aria-label="Cancel" title="Cancel" onClick={() => setAdding(false)}>
              <X size={14} />
            </IconButton>
          </div>
          <Input
            autoFocus
            value={search}
            onChange={(e) => void runSearch(e.target.value)}
            placeholder="Search work item by key or title…"
            className="mt-2"
          />
          {hits.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-border-inner">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => void addLink(h.id)}
                    disabled={linkMutation.isPending}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-ui-md hover:bg-surface-hover disabled:opacity-50"
                  >
                    <span className="font-mono text-primary-light">{h.itemKey}</span>
                    <span className="truncate text-muted-foreground">{h.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-1 text-ui-sm text-destructive">{error}</p>}
        </div>
      )}

      {isLoading ? (
        <p className="text-ui-md text-foreground-subtle">Loading…</p>
      ) : relations.length === 0 ? (
        <p className="text-ui-md text-foreground-subtle">No linked items.</p>
      ) : (
        <div className="space-y-2">
          {grouped.map(([label, items]) => (
            <div key={label}>
              <div className="text-ui-sm font-medium text-foreground-subtle">{label}</div>
              <ul className="mt-0.5 space-y-0.5">
                {items.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-surface-hover"
                  >
                    <WorkItemRefCell
                      type={r.relatedItem.type as WorkItemType}
                      itemKey={r.relatedItem.itemKey}
                      title={r.relatedItem.title}
                      onOpen={() =>
                        navigate({
                          to: '/item/$itemKey',
                          params: { itemKey: r.relatedItem.itemKey },
                        })
                      }
                    />
                    {!readOnly && (
                      <IconButton
                        variant="destructive"
                        aria-label="Remove link"
                        title="Remove link"
                        onClick={() => void unlinkMutation.mutate(r.id)}
                        disabled={unlinkMutation.isPending}
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
