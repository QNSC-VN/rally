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
import { BRAND } from '@/shared/config/brand'
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
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.'
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
          className="flex flex-1 flex-col items-center justify-center gap-4 py-24"
          style={{ backgroundColor: BRAND.pageBg }}
          role="alert"
          aria-live="assertive"
        >
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: '#fef2f2' }}
          >
            <AlertTriangle size={30} style={{ color: '#dc2626' }} />
          </div>
          <div className="text-center">
            <p className="text-[22px] font-bold leading-none" style={{ color: BRAND.textPrimary }}>
              Something went wrong
            </p>
            <p className="mt-2 max-w-xs text-[13px]" style={{ color: BRAND.textSecondary }}>
              {this.state.errorMessage ?? 'An unexpected error occurred on this page.'}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="mt-2 rounded px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: BRAND.primary }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
