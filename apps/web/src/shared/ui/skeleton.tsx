import { cn } from '@/shared/lib/utils'

interface SkeletonProps {
  className?: string
}

/** Single pulsing block */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded bg-[#e8ecf1]', className)}
      aria-hidden="true"
    />
  )
}

/** A single table-row skeleton — matches Rally's h-8 list rows */
export function SkeletonRow({ cols = 6 }: { cols?: number }) {
  const widths = ['w-14', 'w-20', 'flex-1', 'w-24', 'w-20', 'w-16']
  return (
    <div className="flex h-8 items-center gap-3 px-3" aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3 shrink-0', widths[i] ?? 'w-16')} />
      ))}
    </div>
  )
}

/** Stack of skeleton rows for list loading states */
export function SkeletonList({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col divide-y divide-[#f1f4f8]" aria-label="Loading…" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} cols={cols} />
      ))}
    </div>
  )
}

/** Full-panel skeleton for detail sidebars */
export function SkeletonField() {
  return (
    <div className="flex flex-col gap-1">
      <Skeleton className="h-2.5 w-16" />
      <Skeleton className="h-8 w-full" />
    </div>
  )
}
