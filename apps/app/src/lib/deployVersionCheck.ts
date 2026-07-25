import { APP_BUILD_COMMIT } from '@/lib/appBuildInfo'

const VERSION_JSON = 'version.json'

function versionJsonUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? `${base}${VERSION_JSON}` : `${base}/${VERSION_JSON}`
}

/**
 * Reads the commit currently published at the same origin (served from `version.json` on deploy).
 * Returns null if missing or invalid (e.g. first load after deploy, offline).
 */
export async function fetchDeployedBuildCommit(): Promise<string | null> {
  try {
    const res = await fetch(versionJsonUrl(), {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { commit?: unknown }
    const c = typeof data.commit === 'string' ? data.commit.trim() : ''
    return c || null
  } catch {
    return null
  }
}

/** True when this tab’s bundle commit differs from the live site’s `version.json`. */
export async function isStaleDeploy(): Promise<boolean> {
  if (!APP_BUILD_COMMIT) return false
  const live = await fetchDeployedBuildCommit()
  if (!live) return false
  return live !== APP_BUILD_COMMIT
}
