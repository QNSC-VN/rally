/**
 * Page-level Error Boundary — catches React render errors inside the page outlet.
 * A crash in one page does NOT white-screen the entire app (SHELL-FR-013).
 *
 * Usage:
 *   <PageErrorBoundary>
 *     <Outlet />
 *   </PageErrorBoundary>
 */
import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  errorMessage: string | null
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null }

  static getDerivedStateFromError(error: unknown): State {
    // Client-side render crash — deliberately distinct copy from the backend's
    // 500 "An unexpected error occurred" so a failure can be traced to the right
    // layer (browser render vs server request).
    const message = error instanceof Error ? error.message : 'This page failed to render.'
    return { hasError: true, errorMessage: message }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    // In production, ship to error monitoring (Sentry/DataDog/New Relic)
    if (import.meta.env.PROD) {
      console.error('[ErrorBoundary] Page render error:', error, info.componentStack)
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 bg-background py-24"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive-bg">
            <AlertTriangle size={30} className="text-destructive" />
          </div>
          <div className="text-center">
            <p className="text-xl leading-none font-bold text-foreground">Something went wrong</p>
            <p className="mt-2 max-w-xs text-ui-lg text-muted-foreground">
              {this.state.errorMessage ??
                'This page failed to render. Try again, or reload if it persists.'}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="mt-2 rounded bg-primary px-4 py-2 text-ui-lg font-semibold text-white transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
