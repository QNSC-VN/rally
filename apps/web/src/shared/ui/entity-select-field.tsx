/**
 * OwnerSelectField / TeamSelectField — labelled owner/team pickers that render
 * the shared identity glyph (round {@link OwnerAvatar} for people, square
 * {@link TeamAvatar} for teams) before the name — matching the read-only cells
 * and the in-grid OwnerSelectCell so every surface speaks the same visual
 * language (circle = person, square = team).
 *
 * Built on the same overlay pattern as InlineCellSelect: a visible avatar + name
 * row with a transparent native <select> on top for interaction, sized like a
 * form field (mirrors NativeSelect). Collapses the `FormField > NativeSelect >
 * members.map / teams.map` block that was copy-pasted across detail panels and
 * create/edit modals into one primitive.
 *
 * `onChange` emits the raw select value ('' for the empty option); callers map
 * it to `null` when they persist (e.g. `onChange={(v) => update({ assigneeId: v || null })}`).
 */
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'
import { FormField } from './form-field'
import { OwnerAvatar } from './owner-cell'
import { TeamAvatar } from './team-cell'

export interface SelectableMember {
  userId: string
  displayName?: string | null
  email?: string | null
}

export interface SelectableTeam {
  id: string
  name: string
  key?: string | null
}

/** Form-sized overlay select with a leading glyph + resolved display text. */
function OverlaySelectField({
  label,
  id,
  value,
  onChange,
  disabled,
  leading,
  displayText,
  muted,
  children,
}: {
  label: string
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  leading?: ReactNode
  displayText: string
  muted?: boolean
  children: ReactNode
}) {
  return (
    <FormField label={label} htmlFor={id}>
      <div
        className={cn(
          'relative flex w-full items-center gap-2 rounded border border-input bg-white px-3 py-2 transition-colors',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          disabled && 'cursor-not-allowed bg-input-background opacity-60',
        )}
      >
        {leading}
        <span
          className="min-w-0 flex-1 truncate text-ui-md"
          style={{ color: muted ? BRAND.textDisabled : BRAND.textPrimary }}
        >
          {displayText}
        </span>
        <ChevronDown size={14} className="shrink-0" style={{ color: BRAND.textMuted }} />
        <select
          id={id}
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        >
          {children}
        </select>
      </div>
    </FormField>
  )
}

interface OwnerSelectFieldProps {
  value: string | null | undefined
  onChange: (value: string) => void
  members: SelectableMember[]
  label?: string
  placeholder?: string
  id?: string
  disabled?: boolean
}

export function OwnerSelectField({
  value,
  onChange,
  members,
  label = 'Owner',
  placeholder = 'Unassigned',
  id,
  disabled,
}: OwnerSelectFieldProps) {
  const current = value ? members.find((m) => m.userId === value) : undefined
  const name = current ? (current.displayName ?? current.email ?? current.userId) : null
  return (
    <OverlaySelectField
      label={label}
      id={id}
      value={value ?? ''}
      onChange={onChange}
      disabled={disabled}
      leading={name ? <OwnerAvatar name={name} /> : undefined}
      displayText={name ?? placeholder}
      muted={!name}
    >
      <option value="">{placeholder}</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.displayName ?? m.email ?? m.userId}
        </option>
      ))}
    </OverlaySelectField>
  )
}

interface TeamSelectFieldProps {
  value: string | null | undefined
  onChange: (value: string) => void
  teams: SelectableTeam[]
  label?: string
  placeholder?: string
  id?: string
  disabled?: boolean
}

export function TeamSelectField({
  value,
  onChange,
  teams,
  label = 'Team',
  placeholder = 'No team',
  id,
  disabled,
}: TeamSelectFieldProps) {
  const current = value ? teams.find((t) => t.id === value) : undefined
  return (
    <OverlaySelectField
      label={label}
      id={id}
      value={value ?? ''}
      onChange={onChange}
      disabled={disabled}
      leading={current ? <TeamAvatar teamKey={current.key} name={current.name} /> : undefined}
      displayText={current ? current.name : placeholder}
      muted={!current}
    >
      <option value="">{placeholder}</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </OverlaySelectField>
  )
}
