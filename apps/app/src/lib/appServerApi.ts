import { appendClientLog } from '@/lib/crashReporting/clientLogBuffer'
import { shouldSkipNetworkRequests } from '@/lib/networkConnectivity'

/**
 * Stable, host-agnostic paths for server routes. Production maps them via `public/_redirects`
 * (`/api/*` → `/.netlify/functions/:splat`). Client code should not reference `/.netlify/functions/…` directly.
 *
 * If the API is moved to another origin (Railway, Fly, etc.), set `VITE_APP_SERVER_API_ORIGIN`
 * (no trailing slash); URLs become `${origin}/api/...`.
 */
const APP_SERVER_API_ORIGIN = (import.meta.env.VITE_APP_SERVER_API_ORIGIN as string | undefined)?.replace(
  /\/$/,
  '',
) ?? ''

export const APP_SERVER_API_PATHS = {
  tutorialConfig: '/api/tutorial-config',
  convertPdf: '/api/convert-pdf',
  convertDxf: '/api/convert-dxf',
  convertDwg: '/api/convert-dwg',
  
} as const

export type AppServerApiPath = (typeof APP_SERVER_API_PATHS)[keyof typeof APP_SERVER_API_PATHS]

export function appServerApiUrl(path: AppServerApiPath): string {
  return `${APP_SERVER_API_ORIGIN}${path}`
}

/**
 * `fetch` to an app-hosted `/api/*` route with non-OK and network failures recorded in the crash client log buffer.
 */
export async function fetchAppServerApi(path: AppServerApiPath, init?: RequestInit): Promise<Response> {
  if (shouldSkipNetworkRequests()) {
    throw new Error(`Offline — cannot call ${path}`)
  }
  const url = appServerApiUrl(path)
  try {
    const res = await fetch(url, init)
    if (!res.ok) {
      appendClientLog({
        kind: 'api_failure',
        message: `${path} HTTP ${res.status}`,
      })
    }
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendClientLog({
      kind: 'api_failure',
      message: `${path} network: ${msg}`,
    })
    throw e
  }
}
