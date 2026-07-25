import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@/lib/logger'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class CommunityErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('Condui Community encountered an error.', error, errorInfo)
  }

  private reload = (): void => window.location.reload()

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-50 px-6 py-12 text-center text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
          Reload the app to continue. Error details are available in your browser console.
        </p>
        <button
          type="button"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          onClick={this.reload}
        >
          Reload app
        </button>
      </div>
    )
  }
}
