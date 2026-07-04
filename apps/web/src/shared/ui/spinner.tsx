import { cn } from '@/shared/lib/utils'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' }

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        'animate-spin rounded-full border-2 border-primary border-t-transparent',
        SIZE[size],
        className,
      )}
    />
  )
}

export function PageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner size="lg" />
    </div>
  )
}

export function InlineSpinner({ className }: { className?: string }) {
  return <Spinner size="sm" className={cn('text-primary', className)} />
}
