/**
 * SelectionModal — a searchable multi-select "link entities" modal.
 *
 * Built on AppModal. Used wherever the user picks a set of entities to link
 * (e.g. milestone → projects / teams / releases). Keeps a local draft while
 * open and commits via `onSave` on confirm, surfacing success / error toasts.
 */
import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { SearchInput } from '@/shared/ui/search-input'
import { SelectionCheckbox } from '@/shared/ui/selection-checkbox'

export interface SelectionItem {
  id: string
  name: string
}

interface SelectionModalProps {
  open: boolean
  onClose: () => void
  title: string
  items: SelectionItem[]
  selectedIds: string[]
  onSave: (ids: string[]) => Promise<void>
}

export function SelectionModal({
  open,
  onClose,
  title,
  items,
  selectedIds,
  onSave,
}: SelectionModalProps) {
  const [search, setSearch] = useState('')
  const [local, setLocal] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Reset the draft each time the modal transitions closed -> open. Adjusting
  // state during render (React's recommended pattern) instead of in an effect
  // avoids the extra commit + cascading-render that a setState-in-effect causes.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setLocal([...selectedIds])
      setSearch('')
    }
  }

  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((it) => it.name.toLowerCase().includes(q))
  }, [items, search])

  function toggle(id: string) {
    setLocal((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAll() {
    if (filtered.every((it) => local.includes(it.id))) {
      setLocal((prev) => prev.filter((id) => !filtered.some((f) => f.id === id)))
    } else {
      setLocal((prev) => {
        const next = new Set(prev)
        filtered.forEach((it) => next.add(it.id))
        return [...next]
      })
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(local)
      toast.success(`${title} updated`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to update ${title.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((it) => local.includes(it.id))

  return (
    <AppModal open={open} onClose={onClose} title={title} width={440}>
      {/* Search bar above ModalBody */}
      <div className="px-5 pt-3 pb-1">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search ${title.toLowerCase()}...`}
          ariaLabel={`Search ${title.toLowerCase()}`}
          iconSize={13}
          autoFocus
          className="w-full rounded-md py-1.5 pl-8 text-xs"
        />
      </div>
      <ModalBody className="space-y-1">
        {/* Select-all row */}
        <label
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-ui-sm font-semibold select-none hover:bg-gray-50"
          style={{ color: BRAND.textSecondary }}
        >
          <SelectionCheckbox
            checked={allFilteredSelected}
            onChange={toggleAll}
            ariaLabel={allFilteredSelected ? 'Deselect all' : 'Select all'}
          />
          {allFilteredSelected ? 'Deselect All' : 'Select All'} ({filtered.length})
        </label>
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: BRAND.textMuted }}>
              No items found
            </p>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs transition-colors select-none hover:bg-gray-50"
              >
                <SelectionCheckbox
                  checked={local.includes(item.id)}
                  onChange={() => toggle(item.id)}
                  ariaLabel={item.name}
                />
                <span className="truncate" style={{ color: BRAND.textPrimary }}>
                  {item.name}
                </span>
              </label>
            ))
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => {
            void handleSave()
          }}
          disabled={saving}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          Save
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
