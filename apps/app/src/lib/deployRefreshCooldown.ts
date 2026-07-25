const REFRESH_COOLDOWN_STORAGE_KEY = 'eendra.deployRefreshBanner.lastRefreshAt'
const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000

type DeployRefreshStorage = Pick<Storage, 'getItem' | 'setItem'>

function getStorage(): DeployRefreshStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function markDeployRefreshRequested(nowMs = Date.now(), storage = getStorage()): void {
  if (!storage) return
  try {
    storage.setItem(REFRESH_COOLDOWN_STORAGE_KEY, String(nowMs))
  } catch {
    // Best-effort only; the refresh action should not depend on localStorage.
  }
}

export function isDeployRefreshCooldownActive(nowMs = Date.now(), storage = getStorage()): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(REFRESH_COOLDOWN_STORAGE_KEY)
    if (!raw) return false
    const lastRefreshAt = Number(raw)
    if (!Number.isFinite(lastRefreshAt) || lastRefreshAt <= 0) return false
    return nowMs - lastRefreshAt >= 0 && nowMs - lastRefreshAt < REFRESH_COOLDOWN_MS
  } catch {
    return false
  }
}
