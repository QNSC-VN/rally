/**
 * LinkedItemsBlock — F6 work-item relations panel for the Work Item Detail page.
 *
 * Shows every linked item grouped by relation label (Blocks / Blocked by /
 * Relates to / …), lets an editor add a link (pick relation type + search a
 * target work item in the same project) and remove existing links.
 * Mirrors the AttachmentBlock layout/readOnly conventions.
 */
import { useMemo, useState } from 'react'
import { Link2, Plus, Trash2, X } from 'lucide-react'
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
  { value: 'causes', label: 'Causes' },
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
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5c6478]">
          <Link2 size={13} />
          Linked Items
          {relations.length > 0 && <span className="text-[#9ca3af]">({relations.length})</span>}
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#2558a6] hover:bg-[#eef3fb]"
          >
            <Plus size={12} />
            Link item
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 rounded border border-[#d7dde7] p-2">
          <div className="flex items-center justify-between">
            <select
              value={relationType}
              onChange={(e) => setRelationType(e.target.value as WorkItemRelationType)}
              className="rounded border border-[#d7dde7] px-2 py-1 text-[12px]"
            >
              {RELATION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              aria-label="Cancel"
              onClick={() => setAdding(false)}
              className="p-1 text-[#9ca3af]"
            >
              <X size={14} />
            </button>
          </div>
          <input
            autoFocus
            value={search}
            onChange={(e) => void runSearch(e.target.value)}
            placeholder="Search work item by key or title…"
            className="mt-2 w-full rounded border border-[#d7dde7] px-2 py-1 text-[12px]"
          />
          {hits.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-[#eef0f4]">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => void addLink(h.id)}
                    disabled={linkMutation.isPending}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-[#f6f8fb] disabled:opacity-50"
                  >
                    <span className="font-mono text-[#2558a6]">{h.itemKey}</span>
                    <span className="truncate text-[#5c6478]">{h.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-1 text-[11px] text-[#b91c1c]">{error}</p>}
        </div>
      )}

      {isLoading ? (
        <p className="text-[12px] text-[#9ca3af]">Loading…</p>
      ) : relations.length === 0 ? (
        <p className="text-[12px] text-[#9ca3af]">No linked items.</p>
      ) : (
        <div className="space-y-2">
          {grouped.map(([label, items]) => (
            <div key={label}>
              <div className="text-[11px] font-medium text-[#8c94a6]">{label}</div>
              <ul className="mt-0.5 space-y-0.5">
                {items.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded px-1.5 py-1 hover:bg-[#f6f8fb]"
                  >
                    <span className="flex items-center gap-2 text-[12px]">
                      <span className="font-mono text-[#2558a6]">{r.relatedItem.itemKey}</span>
                      <span className="truncate text-[#3a4252]">{r.relatedItem.title}</span>
                    </span>
                    {!readOnly && (
                      <button
                        aria-label="Remove link"
                        onClick={() => void unlinkMutation.mutate(r.id)}
                        disabled={unlinkMutation.isPending}
                        className="p-1 text-[#b0b6c0] hover:text-[#b91c1c] disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                      </button>
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
