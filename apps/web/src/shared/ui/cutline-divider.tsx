import { BRAND } from '@/shared/config/brand'

/**
 * The line between "this fits" and "this does not".
 *
 * Rally draws a cutline through a ranked list: everything above it fits inside the capacity,
 * everything below is what would be dropped. It is a divider BETWEEN rows rather than a mark
 * on one, because that is the actual claim — a per-row badge would let a client render an
 * incoherent picture (a "fits" row below a "does not fit" one).
 *
 * Takes its label as a prop so `shared/ui` stays out of any feature's copy, and carries the
 * label as text rather than colour alone: a red line means nothing to someone who cannot see
 * it, and nothing at all to someone reading the DOM.
 */
export function CutlineDivider({ label }: { label: string }) {
  return (
    <div
      // `separator` with a name, so the boundary is announced rather than being purely visual.
      role="separator"
      aria-label={label}
      data-cutline="true"
      className="flex items-center gap-2 px-3 py-1 select-none"
    >
      <span className="h-px flex-1" style={{ backgroundColor: BRAND.warning }} />
      <span
        className="text-ui-xs font-medium tracking-wide uppercase"
        style={{ color: BRAND.warning }}
      >
        {label}
      </span>
      <span className="h-px flex-1" style={{ backgroundColor: BRAND.warning }} />
    </div>
  )
}
