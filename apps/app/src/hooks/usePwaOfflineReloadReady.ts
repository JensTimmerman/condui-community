import { useEffect, useState } from 'react'
import { isPwaOfflineShellReady } from '@/lib/pwa/registerAppServiceWorker'

function readOfflineReloadReady(): boolean {
  if (typeof navigator === 'undefined') return true
  if (import.meta.env.DEV) return false
  if (!import.meta.env.PROD) return true
  if (!('serviceWorker' in navigator)) return false
  return Boolean(navigator.serviceWorker.controller) || isPwaOfflineShellReady()
}

/** True when a normal refresh should still load the cached app shell (production + SW). */
export function usePwaOfflineReloadReady() {
  const [reloadReady, setReloadReady] = useState(readOfflineReloadReady)

  useEffect(() => {
    if (import.meta.env.DEV || !import.meta.env.PROD || !('serviceWorker' in navigator)) {
      return
    }

    let active = true
    const sync = () => {
      if (!active) return
      setReloadReady(readOfflineReloadReady())
    }

    void navigator.serviceWorker.ready.then(sync)
    navigator.serviceWorker.addEventListener('controllerchange', sync)

    return () => {
      active = false
      navigator.serviceWorker.removeEventListener('controllerchange', sync)
    }
  }, [])

  return {
    reloadReady,
    showDevReloadHint: import.meta.env.DEV,
    showProdReloadHint: import.meta.env.PROD && !reloadReady,
  }
}
