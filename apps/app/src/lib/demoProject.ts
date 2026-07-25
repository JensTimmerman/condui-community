/** Bundled /demo editor projects use ids `demo` or `demo-<uuid>`. */
export function isDemoProjectId(projectId: string | null | undefined): boolean {
  if (!projectId) return false
  return projectId === 'demo' || projectId.startsWith('demo-')
}
