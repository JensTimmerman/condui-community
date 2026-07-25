/**
 * UI contract: functions and types for UI integration
 * No React or UI code here - just the contract
 */
import type { Issue, Severity } from './types'

export interface IssueFilters {
  severity?: Issue['severity'][]
  ruleId?: string[]
  tags?: string[]
  scopeType?: Issue['scope']['type'][]
}

export interface IssueSort {
  by: 'severity' | 'ruleId' | 'scope'
  order?: 'asc' | 'desc'
}

/**
 * Get filtered and sorted issues
 * Implementation will be a thin wrapper over validateProject result
 */
export function getIssues(
  issues: Issue[],
  filters?: IssueFilters,
  sort?: IssueSort
): Issue[] {
  let filtered = [...issues]

  // Apply filters
  if (filters) {
    if (filters.severity && filters.severity.length > 0) {
      filtered = filtered.filter((issue) => filters.severity!.includes(issue.severity))
    }
    if (filters.ruleId && filters.ruleId.length > 0) {
      filtered = filtered.filter((issue) => filters.ruleId!.includes(issue.ruleId))
    }
    if (filters.tags && filters.tags.length > 0) {
      filtered = filtered.filter((issue) => {
        if (!issue.tags || issue.tags.length === 0) return false
        return filters.tags!.some((tag) => issue.tags!.includes(tag))
      })
    }
    if (filters.scopeType && filters.scopeType.length > 0) {
      filtered = filtered.filter((issue) => filters.scopeType!.includes(issue.scope.type))
    }
  }

  // Apply sort
  if (sort) {
    const order = sort.order || 'asc'
    filtered.sort((a, b) => {
      let cmp = 0
      if (sort.by === 'severity') {
        const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
        cmp = severityOrder[a.severity] - severityOrder[b.severity]
      } else if (sort.by === 'ruleId') {
        cmp = a.ruleId.localeCompare(b.ruleId)
      } else if (sort.by === 'scope') {
        const aKey = `${a.scope.type}:${a.scope.id}`
        const bKey = `${b.scope.type}:${b.scope.id}`
        cmp = aKey.localeCompare(bKey)
      }
      return order === 'asc' ? cmp : -cmp
    })
  }

  return filtered
}

/**
 * Get element IDs and view hints for focusing an issue
 */
export function focusIssue(issueId: string, issues: Issue[]): {
  elementIds: string[]
  viewHints: ('eendraad' | 'sitplan')[]
} {
  const issue = issues.find((i) => i.id === issueId)
  if (!issue) {
    return { elementIds: [], viewHints: [] }
  }

  const elementIds = issue.offenders.map((o) => o.id)
  const viewHints = Array.from(
    new Set(issue.offenders.map((o) => o.viewHint).flat())
  ) as ('eendraad' | 'sitplan')[]

  return { elementIds, viewHints }
}

/**
 * Subscribe to validation changes
 * Returns unsubscribe function
 * Implementation will be store-driven (e.g. projectStore or validationStore)
 */
export type ValidationChangeCallback = (issues: Issue[]) => void

export function subscribeToValidationChanges(
  _callback: ValidationChangeCallback
): () => void {
  // Stub: returns a no-op unsubscribe
  // Real implementation will be in a store that runs validation and notifies subscribers
  return () => {
    // No-op unsubscribe
  }
}
