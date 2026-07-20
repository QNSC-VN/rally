import * as React from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Card / CardHeader / CardBody — the standard bordered section shell.
 *
 * Replaces the `rounded bg-white border + header bar` block hand-rolled across
 * ~14 sites (attachment-block, rich-text-editor, work-item detail sections, and
 * many page panels). Token-backed so it adapts to dark mode automatically —
 * unlike the `bg-white` literals it replaces.
 *
 * Usage:
 *   <Card>
 *     <CardHeader title="Description" actions={<IconButton .../>} />
 *     <CardBody>…</CardBody>
 *   </Card>
 */

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('overflow-hidden rounded-md border border-border-subtle bg-card', className)}
      {...props}
    />
  )
}

interface CardHeaderProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  /** Section title (left-aligned). */
  title?: React.ReactNode
  /** Optional leading icon before the title. */
  icon?: React.ReactNode
  /** Optional right-aligned controls (buttons, menus, expand toggle). */
  actions?: React.ReactNode
}

export function CardHeader({
  className,
  title,
  icon,
  actions,
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2.5',
        className,
      )}
      {...props}
    >
      {children ?? (
        <div className="flex min-w-0 items-center gap-1.5">
          {icon}
          {title && (
            <span className="truncate text-ui-md font-semibold text-foreground">{title}</span>
          )}
        </div>
      )}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-body" className={cn('p-4', className)} {...props} />
}
