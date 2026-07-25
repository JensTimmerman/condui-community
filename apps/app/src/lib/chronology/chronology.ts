import type {
  ChronologyAssignmentRoleV2,
  ChronologyAssignmentV2,
  ChronologyEntityRefV2,
  ChronologyEventKindV2,
  ChronologyModelV2,
  ChronologySourceV2,
  DisciplineModelsV2,
  SystemKindV2,
} from '@/types/projectV2'
import type { InstallDateTarget } from '@/lib/installDatePropagation'
import { ensureInstallYearColor, normalizeInstallYear } from '@/lib/installDates'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

export type ChronologyProject = ProjectWithOptionalV2Electrical & {
  project: {
    installDateColors?: Record<string, string>
  }
  chronology?: ChronologyModelV2
}

export function emptyChronology(): ChronologyModelV2 {
  return { version: 1, events: [], assignments: [] }
}

export function ensureProjectChronology(project: ChronologyProject): ChronologyModelV2 {
  if (!project.chronology) project.chronology = emptyChronology()
  if (project.chronology.version !== 1) project.chronology.version = 1
  project.chronology.events ??= []
  project.chronology.assignments ??= []
  return project.chronology
}

export function chronologyYearDate(year: number): string {
  return `${String(year).padStart(4, '0')}-01-01T00:00:00.000Z`
}

function stablePart(value: string | undefined): string {
  return (value ?? 'any').replace(/[^a-zA-Z0-9_-]+/g, '_')
}

export function chronologyEventIdFor(options: {
  source: ChronologySourceV2
  kind: ChronologyEventKindV2
  date: string
  versionId?: string | null
  label?: string | null
}): string {
  if (options.versionId) return `chron_event_version_${stablePart(options.versionId)}`
  const dateKey = options.date.slice(0, 10)
  return `chron_event_${stablePart(options.source)}_${stablePart(options.kind)}_${stablePart(dateKey)}`
}

export function chronologyAssignmentIdFor(
  eventId: string,
  entityRef: ChronologyEntityRefV2,
  role: ChronologyAssignmentRoleV2
): string {
  return [
    'chron_assign',
    stablePart(eventId),
    stablePart(entityRef.system),
    stablePart(entityRef.discipline),
    stablePart(entityRef.type),
    stablePart(entityRef.id),
    stablePart(role),
  ].join('_')
}

export function installDateTargetToChronologyRef(target: InstallDateTarget): ChronologyEntityRefV2 {
  return {
    system: 'electrical',
    discipline: 'electrical',
    type: target.type,
    id: target.id,
  }
}

export function upsertChronologyEvent(
  project: ChronologyProject,
  options: {
    date: string
    kind: ChronologyEventKindV2
    source: ChronologySourceV2
    granularity?: 'year' | 'month' | 'day' | 'instant'
    label?: string | null
    versionId?: string | null
    savedAt?: string | null
    metadata?: Record<string, unknown>
  }
): string {
  const chronology = ensureProjectChronology(project)
  const eventId = chronologyEventIdFor(options)
  const existing = chronology.events.find((event) => event.id === eventId)
  const next = {
    id: eventId,
    date: options.date,
    granularity: options.granularity ?? 'day',
    kind: options.kind,
    source: options.source,
    ...(options.label ? { label: options.label } : {}),
    ...(options.versionId ? { versionId: options.versionId } : {}),
    ...(options.savedAt ? { savedAt: options.savedAt } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  }
  if (existing) {
    Object.assign(existing, next)
  } else {
    chronology.events.push(next)
  }
  return eventId
}

export function upsertChronologyAssignment(
  project: ChronologyProject,
  options: {
    eventId: string
    entityRef: ChronologyEntityRefV2
    role: ChronologyAssignmentRoleV2
    source: ChronologyAssignmentV2['source']
    locked?: boolean
    metadata?: Record<string, unknown>
  }
): string {
  const chronology = ensureProjectChronology(project)
  const assignmentId = chronologyAssignmentIdFor(options.eventId, options.entityRef, options.role)
  const existing = chronology.assignments.find((assignment) => assignment.id === assignmentId)
  const next: ChronologyAssignmentV2 = {
    id: assignmentId,
    eventId: options.eventId,
    entityRef: options.entityRef,
    role: options.role,
    source: options.source,
    ...(options.locked != null ? { locked: options.locked } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  }
  if (existing) {
    Object.assign(existing, next)
  } else {
    chronology.assignments.push(next)
  }
  return assignmentId
}

export function clearChronologyAssignmentsForEntity(
  project: ChronologyProject,
  entityRef: ChronologyEntityRefV2,
  options?: { sources?: ChronologyAssignmentV2['source'][]; roles?: ChronologyAssignmentRoleV2[] }
): void {
  const chronology = ensureProjectChronology(project)
  chronology.assignments = chronology.assignments.filter((assignment) => {
    const sameEntity =
      assignment.entityRef.id === entityRef.id &&
      assignment.entityRef.type === entityRef.type &&
      assignment.entityRef.system === entityRef.system &&
      assignment.entityRef.discipline === entityRef.discipline
    if (!sameEntity) return true
    if (options?.sources && !options.sources.includes(assignment.source)) return true
    if (options?.roles && !options.roles.includes(assignment.role)) return true
    return false
  })
}

export function assignManualInstallYearToTarget(
  project: ChronologyProject,
  target: InstallDateTarget,
  year: number | undefined,
  options?: { role?: ChronologyAssignmentRoleV2; label?: string }
): void {
  const entityRef = installDateTargetToChronologyRef(target)
  clearChronologyAssignmentsForEntity(project, entityRef, {
    sources: ['manual'],
    roles: ['added', 'exists-at'],
  })
  const normalizedYear = normalizeInstallYear(year)
  if (normalizedYear == null) return
  ensureInstallYearColor(project, normalizedYear)
  const date = chronologyYearDate(normalizedYear)
  const eventId = upsertChronologyEvent(project, {
    date,
    kind: 'renovation',
    source: 'manual',
    granularity: 'year',
    label: options?.label ?? String(normalizedYear),
  })
  upsertChronologyAssignment(project, {
    eventId,
    entityRef,
    role: options?.role ?? 'exists-at',
    source: 'manual',
    locked: true,
  })
}

export function assignVersionDiffToChronology(
  project: ChronologyProject,
  options: {
    versionId: string
    milestoneAt: string
    savedAt?: string | null
    label?: string | null
    entityRefs: Array<{
      entityRef: ChronologyEntityRefV2
      role: ChronologyAssignmentRoleV2
      metadata?: Record<string, unknown>
    }>
  }
): void {
  const eventId = upsertChronologyEvent(project, {
    date: options.milestoneAt,
    kind: 'version',
    source: 'version',
    granularity: 'instant',
    versionId: options.versionId,
    savedAt: options.savedAt,
    label: options.label,
  })
  for (const entry of options.entityRefs) {
    upsertChronologyAssignment(project, {
      eventId,
      entityRef: entry.entityRef,
      role: entry.role,
      source: 'version-diff',
      metadata: entry.metadata,
    })
  }
}

export function legacyEntityRef(
  type: string,
  id: string,
  options?: { system?: SystemKindV2; discipline?: keyof DisciplineModelsV2 | 'custom' }
): ChronologyEntityRefV2 {
  return {
    system: options?.system ?? 'electrical',
    discipline: options?.discipline ?? 'electrical',
    type,
    id,
  }
}

export interface ReconstructedChronologyTimelineItem {
  eventId: string
  date: string
  label: string | null
  source: ChronologySourceV2
  assignmentCount: number
  assignments: ChronologyAssignmentV2[]
}

export function buildReconstructedChronologyTimeline(
  project: ChronologyProject
): ReconstructedChronologyTimelineItem[] {
  const chronology = ensureProjectChronology(project)
  return chronology.events
    .map((event) => {
      const assignments = chronology.assignments.filter((assignment) => assignment.eventId === event.id)
      return {
        eventId: event.id,
        date: event.date,
        label: event.label ?? null,
        source: event.source,
        assignmentCount: assignments.length,
        assignments,
      }
    })
    .filter((item) => item.assignmentCount > 0)
    .sort((left, right) => right.date.localeCompare(left.date))
}
