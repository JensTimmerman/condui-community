/** Full git SHA baked into this bundle at build time (see `vite.config.ts`). */
export const APP_BUILD_COMMIT = (import.meta.env.VITE_APP_BUILD_COMMIT ?? '').trim()

/** Short label for display (typical 7-char prefix of a full SHA). */
export function getAppBuildCommitShortLabel(): string | null {
  if (!APP_BUILD_COMMIT) return null
  return APP_BUILD_COMMIT.length >= 7 ? APP_BUILD_COMMIT.slice(0, 7) : APP_BUILD_COMMIT
}
