/**
 * DetailField primitives — the shared building blocks for a detail page's
 * right sidebar. They replace the `<div className="space-y-1"><label…>…` and
 * `<div className="py-1 text-ui-md font-semibold…">` markup that release- and
 * milestone-detail each re-typed for every metadata field, so label typography,
 * spacing and read-only value styling stay identical across detail pages.
 */
import type { ReactNode } from 'react'

import { FormField } from '@/shared/ui/form-field'

/** Section heading inside the sidebar (e.g. "Details", "Metadata"). */
export function DetailSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-ui-sm font-semibold tracking-wider text-foreground-subtle uppercase">
      {children}
    </h2>
  )
}

/**
 * A labelled field for a detail sidebar. Delegates to the shared {@link FormField}
 * so the label typography + spacing is byte-for-byte identical to the Work Item
 * detail sidebar (the reference for every detail page).
 */
export function DetailField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <FormField label={label}>{children}</FormField>
}

/** Two fields side by side (dates, velocity/estimate…). */
export function DetailFieldPair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

/**
 * Read-only value display for a {@link DetailField}. Renders the SAME bordered,
 * input-styled box the Work Item sidebar uses for its read-only fields (e.g.
 * Creation Date, derived Estimate), so a read-only value lines up visually with
 * the editable `<Input>` / `<SearchableSelect variant="field">` controls beside
 * it. `mono` uses a tabular monospace face for dates / numbers.
 */
export function DetailReadonlyValue({
  children,
  mono = false,
}: {
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div
      className={
        mono
          ? 'flex h-9 items-center rounded border border-input bg-input-background px-3 font-mono text-ui-md text-foreground'
          : 'flex h-9 items-center rounded border border-input bg-input-background px-3 text-ui-md text-muted-foreground'
      }
      aria-readonly
    >
      {children}
    </div>
  )
}
