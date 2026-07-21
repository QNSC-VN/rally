import { Link } from '@tanstack/react-router'
import { ShieldOff } from 'lucide-react'
import { Button } from '@/shared/ui/button'

/**
 * 403 Access Denied page (SHELL-FR-014, P0-08).
 * Shown when the user is authenticated but lacks permission for the resource.
 */
export function ForbiddenPage() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 bg-background py-24"
      role="main"
      aria-labelledby="forbidden-heading"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive-bg">
        <ShieldOff size={30} className="text-destructive" />
      </div>
      <div className="text-center">
        <p id="forbidden-heading" className="text-4xl leading-none font-bold text-foreground">
          403
        </p>
        <p className="mt-1 text-ui-xl font-medium text-muted-foreground">Access denied</p>
        <p className="mt-2 max-w-xs text-ui-lg text-muted-foreground" style={{ opacity: 0.8 }}>
          You don't have permission to view this page. Contact your Workspace Admin if you think
          this is a mistake.
        </p>
      </div>
      <Button asChild className="mt-2">
        <Link to="/">Back to Home</Link>
      </Button>
    </div>
  )
}
