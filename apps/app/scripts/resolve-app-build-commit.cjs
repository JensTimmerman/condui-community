const { execSync } = require('child_process')

/**
 * Git SHA for the current build (Netlify: COMMIT_REF; GitHub Actions: GITHUB_SHA; local: git).
 * @param {string} cwd - repo root for `git rev-parse` (e.g. `apps/app`)
 */
function resolveAppBuildCommit(cwd) {
  const candidates = [
    process.env.VITE_APP_BUILD_COMMIT,
    process.env.COMMIT_REF,
    process.env.GITHUB_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
  ]
  for (const c of candidates) {
    const trimmed = c?.trim()
    if (trimmed) return trimmed
  }
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd }).trim()
  } catch {
    return ''
  }
}

module.exports = { resolveAppBuildCommit }
