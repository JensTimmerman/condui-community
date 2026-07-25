type AppUpdateListener = () => void

const listeners = new Set<AppUpdateListener>()

export function onAppServiceWorkerUpdateAvailable(listener: AppUpdateListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyAppServiceWorkerUpdateAvailable(): void {
  for (const listener of listeners) {
    listener()
  }
}
