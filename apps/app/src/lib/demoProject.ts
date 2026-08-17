/** Bundled /demo editor projects use ids `demo` or `demo-<uuid>`. */
export function isDemoProjectId(projectId: string | null | undefined): boolean {
  if (!projectId) return false
  return projectId === 'demo' || projectId.startsWith('demo-')
}

export const DEMO_PROJECT_LIFETIME_MS = 60 * 60 * 1000

type DemoProjectExpiryEnvironment = {
  activeTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  visibilityTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  isVisible?: () => boolean
}

/**
 * Reloads a demo after its disposable editing window expires. The focus and
 * page-show checks cover browsers that throttle timers while a tab is hidden.
 */
export function startDemoProjectExpiry(
  onExpire: () => void = () => window.location.reload(),
  lifetimeMs = DEMO_PROJECT_LIFETIME_MS,
  environment: DemoProjectExpiryEnvironment = {},
): () => void {
  const browserWindow =
    typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : undefined
  const browserDocument =
    typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : undefined
  const activeTarget = environment.activeTarget ?? browserWindow
  const visibilityTarget = environment.visibilityTarget ?? browserDocument
  const isVisible = environment.isVisible ?? (() => browserDocument?.visibilityState === 'visible')
  const expiresAt = Date.now() + lifetimeMs
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const checkExpiry = () => {
    if (stopped) return

    if (timeoutId != null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    const remainingMs = expiresAt - Date.now()
    if (remainingMs <= 0) {
      stopped = true
      onExpire()
      return
    }

    timeoutId = setTimeout(checkExpiry, remainingMs)
  }

  const checkVisibleExpiry = () => {
    if (isVisible()) checkExpiry()
  }

  checkExpiry()
  activeTarget?.addEventListener('focus', checkExpiry)
  activeTarget?.addEventListener('pageshow', checkExpiry)
  visibilityTarget?.addEventListener('visibilitychange', checkVisibleExpiry)

  return () => {
    stopped = true
    if (timeoutId != null) clearTimeout(timeoutId)
    activeTarget?.removeEventListener('focus', checkExpiry)
    activeTarget?.removeEventListener('pageshow', checkExpiry)
    visibilityTarget?.removeEventListener('visibilitychange', checkVisibleExpiry)
  }
}
