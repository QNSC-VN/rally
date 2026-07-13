import { Search } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /**
   * Accessible name announced to screen readers. Falls back to the
   * placeholder so the field is never unlabeled.
   */
  ariaLabel?: string
  /** Fixed pixel width of the field. */
  width?: number
  /** Extra classes merged onto the `<input>` (tailwind-merge resolves conflicts). */
  className?: string
  iconSize?: number
  autoFocus?: boolean
}

/**
 * Shared search field: magnifier icon + text input.
 *
 * Replaces the icon-plus-input markup that every list page used to hand-roll,
 * so styling stays consistent and — crucially — every search box gets an
 * accessible name (defaults to the placeholder). Colors come from the BRAND
 * palette (single source of truth mirroring globals.css).
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel,
  width,
  className,
  iconSize = 12,
  autoFocus,
}: SearchInputProps) {
  return (
    <div className="relative">
      <Search
        size={iconSize}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        style={{ color: BRAND.textMuted }}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
        className={cn('rounded py-1 pr-3 pl-7 text-[11px] focus:outline-none', className)}
        style={{
          backgroundColor: BRAND.inputBg,
          border: `1px solid ${BRAND.border}`,
          color: BRAND.textPrimary,
          width,
        }}
      />
    </div>
  )
}
