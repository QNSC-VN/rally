import { Link } from '@tanstack/react-router'
import { FileQuestion, Home } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-background py-24">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-lighter">
        <FileQuestion size={30} className="text-primary-light" />
      </div>
      <div className="text-center">
        <p className="text-4xl leading-none font-bold text-foreground">404</p>
        <p className="mt-1 text-ui-xl font-medium text-muted-foreground">Page not found</p>
        <p className="mt-1 text-ui-md text-foreground-subtle">
          The page you requested doesn't exist or you don't have access.
        </p>
      </div>
      <Button asChild className="mt-2">
        <Link to="/">
          <Home size={14} />
          Back to Home
        </Link>
      </Button>
    </div>
  )
}
