/**
 * SelectionModal — a searchable multi-select "link entities" modal.
 *
 * Built on AppModal. Used wherever the user picks a set of entities to link
 * (e.g. milestone → projects / teams / releases). Keeps a local draft while
 * open and commits via `onSave` on confirm, surfacing success / error toasts.
 */
import { useMemo, useState, type ReactNode } from 'react'
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
  /** Optional leading icon (e.g. a `<TypeBadge>`) shown before the name, so the
   *  picker matches the icon+key cells used by the list/select fields. */
  icon?: ReactNode
  /**
   * Already in the target set: shown, un-tickable, and annotated.
   *
   * Capacity SRS §247 asks for exactly this — a Feature already allocated to the selected Team stays
   * "visible in the list marked as added, with selection disabled … deliberately **not** removed from
   * the list, so the planner can see what is already in the Team instead of the row disappearing."
   * Filtering such rows out answers "what can I add" while hiding "what is already there".
   */
  disabled?: boolean
  /** Short note beside a disabled row, e.g. `Added`. Ignored unless `disabled`. */
  disabledNote?: string
}

interface SelectionModalProps {
  open: boolean
  onClose: () => void
  title: string
  items: SelectionItem[]
  selectedIds: string[]
  onSave: (ids: string[]) => Promise<void>
  /**
   * Confirm-button text. Defaults to `Save`.
   *
   * A picker that ADDS should say so — Rally's item picker confirms with `Add to Plan`, and "Save"
   * on a list of unticked rows reads as "save nothing".
   */
  confirmLabel?: string
  /** Search placeholder. Defaults to the title, which reads oddly for a title that is a sentence. */
  searchPlaceholder?: string
}

export function SelectionModal({
  open,
  onClose,
  title,
  items,
  selectedIds,
  onSave,
  confirmLabel,
  searchPlaceholder,
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

  /** Select-all and the tick counts ignore disabled rows: they cannot be selected. */
  const selectable = useMemo(() => filtered.filter((it) => !it.disabled), [filtered])

  function toggle(id: string) {
    setLocal((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAll() {
    if (selectable.every((it) => local.includes(it.id))) {
      setLocal((prev) => prev.filter((id) => !selectable.some((f) => f.id === id)))
    } else {
      setLocal((prev) => {
        const next = new Set(prev)
        selectable.forEach((it) => next.add(it.id))
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

  const allFilteredSelected =
    selectable.length > 0 && selectable.every((it) => local.includes(it.id))

  return (
    <AppModal open={open} onClose={onClose} title={title} width={440}>
      {/* Search bar above ModalBody */}
      <div className="px-5 pt-3 pb-1">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}...`}
          ariaLabel={searchPlaceholder ?? `Search ${title.toLowerCase()}`}
          iconSize={13}
          autoFocus
          className="w-full rounded-md py-1.5 pl-8 text-ui-md"
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
          {/* Counts what CAN be ticked, not every visible row — a disabled row is already in. */}
          {allFilteredSelected ? 'Deselect All' : 'Select All'} ({selectable.length})
        </label>
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-ui-md" style={{ color: BRAND.textMuted }}>
              No items found
            </p>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                className={`flex items-center gap-2 rounded px-1 py-1.5 text-ui-md transition-colors select-none ${
                  item.disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-gray-50'
                }`}
              >
                <SelectionCheckbox
                  checked={local.includes(item.id)}
                  disabled={item.disabled}
                  onChange={() => toggle(item.id)}
                  ariaLabel={item.name}
                />
                {item.icon && <span className="flex shrink-0 items-center">{item.icon}</span>}
                <span className="truncate" style={{ color: BRAND.textPrimary }}>
                  {item.name}
                </span>
                {/* The note is what turns a greyed row from "broken" into "already there" (§247). */}
                {item.disabled && item.disabledNote != null && (
                  <span
                    className="ml-auto shrink-0 text-ui-xs font-semibold"
                    style={{ color: BRAND.textMuted }}
                  >
                    {item.disabledNote}
                  </span>
                )}
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
          {confirmLabel ?? 'Save'}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
