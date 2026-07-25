const HARD_RELOAD_PARAM = 'sw-bust'
const WAITING_SERVICE_WORKER_TIMEOUT_MS = 800
const SERVICE_WORKER_ACTIVATION_GRACE_MS = 250
const HARD_RELOAD_CLEANUP_TIMEOUT_MS = 1500

let serviceWorkerRegistration: ServiceWorkerRegistration | null = null

type UpdateReloadOptions = {
  waitingTimeoutMs?: number
  activationGraceMs?: number
  cleanupTimeoutMs?: number
  nowMs?: () => number
}

export function setAppServiceWorkerRegistration(
  registration: ServiceWorkerRegistration | null
): void {
  serviceWorkerRegistration = registration
}

export async function requestAppServiceWorkerUpdateAndReload(
  options: UpdateReloadOptions = {}
): Promise<boolean> {
  const registration = await getAppServiceWorkerRegistration()
  if (!registration) return false

  await registration.update().catch(() => {
    // Best-effort only; some browsers reject when offline.
  })

  const waitingWorker =
    registration.waiting ??
    (await waitForWaitingServiceWorker(registration, options.waitingTimeoutMs))
  if (!waitingWorker) return false

  waitingWorker.postMessage({ type: 'SKIP_WAITING' })

  if (navigator.serviceWorker.controller) {
    await waitForServiceWorkerControllerChange(options.activationGraceMs)
  }

  await forceAppHardReload({
    cleanupTimeoutMs: options.cleanupTimeoutMs,
    nowMs: options.nowMs,
  })
  return true
}

export async function forceAppHardReload(options: UpdateReloadOptions = {}): Promise<void> {
  await withTimeout(cleanupServiceWorkersAndCaches(), options.cleanupTimeoutMs)
  reloadWithCacheBust(options.nowMs)
}

async function getAppServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (serviceWorkerRegistration) return serviceWorkerRegistration
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.getRegistration().catch(() => null)
  serviceWorkerRegistration = registration ?? null
  return serviceWorkerRegistration
}

async function cleanupServiceWorkersAndCaches(): Promise<void> {
  await unregisterServiceWorkers()
  serviceWorkerRegistration = null

  if (typeof caches === 'undefined') return
  const cacheNames = await caches.keys().catch(() => [] as string[])
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName).catch(() => false)))
}

async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const registrations =
    typeof navigator.serviceWorker.getRegistrations === 'function'
      ? await navigator.serviceWorker.getRegistrations().catch(async () => getSingleRegistration())
      : await getSingleRegistration()

  await Promise.all(
    registrations.map((registration) => registration.unregister().catch(() => false))
  )
}

async function getSingleRegistration(): Promise<ServiceWorkerRegistration[]> {
  const registration = await navigator.serviceWorker.getRegistration().catch(() => null)
  return registration ? [registration] : []
}

function reloadWithCacheBust(nowMs = Date.now): void {
  const url = new URL(window.location.href)
  url.searchParams.set(HARD_RELOAD_PARAM, String(nowMs()))
  window.location.replace(url.toString())
}

function waitForServiceWorkerControllerChange(
  timeoutMs = SERVICE_WORKER_ACTIVATION_GRACE_MS
): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (changed: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      resolve(changed)
    }
    const onControllerChange = () => finish(true)
    const timeoutId = setTimeout(() => finish(false), timeoutMs)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  })
}

function waitForWaitingServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = WAITING_SERVICE_WORKER_TIMEOUT_MS
): Promise<ServiceWorker | null> {
  if (registration.waiting) return Promise.resolve(registration.waiting)
  const installingWorker = registration.installing
  if (!installingWorker) return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    const finish = (worker: ServiceWorker | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      installingWorker.removeEventListener('statechange', onStateChange)
      resolve(worker)
    }
    const onStateChange = () => {
      if (installingWorker.state === 'installed' && registration.waiting) {
        finish(registration.waiting)
      } else if (installingWorker.state === 'activated' || installingWorker.state === 'redundant') {
        finish(null)
      }
    }
    const timeoutId = setTimeout(() => finish(registration.waiting ?? null), timeoutMs)
    installingWorker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = HARD_RELOAD_CLEANUP_TIMEOUT_MS
): Promise<T | void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve(value)
    }
    const timeoutId = setTimeout(() => finish(), timeoutMs)
    promise.then(finish, () => finish())
  })
}
