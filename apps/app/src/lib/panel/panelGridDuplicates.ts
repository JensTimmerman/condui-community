import { getModuleDisplayInfo } from '@/components/canvas/panel/getModuleDisplayInfo'
import { panelGridModuleRefKey } from '@/components/canvas/panel/panelGridLayout'
import type { PanelGridModuleRef } from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { findTrunkDeviceInProject } from '@/utils/project'

export interface PanelGridDuplicateCandidate {
  ref: PanelGridModuleRef
  area: 'main' | 'supply'
  row: number
  col: number
  order: number
}

export interface PanelGridDuplicateFinding {
  reason: 'duplicateRef' | 'duplicateVisibleLabel'
  summaryLabel: string
  keep: PanelGridDuplicateCandidate
  remove: PanelGridDuplicateCandidate[]
  hideModuleKeys: string[]
}

function normalizeVisibleLabel(label: string): string | null {
  const normalized = label.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function candidateScore(
  candidate: PanelGridDuplicateCandidate,
  project: ProjectWithOptionalV2Electrical,
): number {
  const info = getModuleDisplayInfo(candidate.ref, project)
  let score = 0

  if (candidate.ref.kind === 'protection') score += 1000
  else if (candidate.ref.kind === 'domotica') score += 700
  else score += 400

  if (candidate.ref.kind === 'trunkDevice' && candidate.ref.scope === 'supply') {
    if (candidate.area === 'supply') score += 25
  } else if (candidate.area === 'main') {
    score += 25
  }
  if (info.label.trim().length > 0) score += 75
  score += info.specLines.length * 20
  score += Math.min(60, info.tooltipText.trim().length)

  return score
}

function compareCandidates(
  a: PanelGridDuplicateCandidate,
  b: PanelGridDuplicateCandidate,
  project: ProjectWithOptionalV2Electrical,
): number {
  const scoreDiff = candidateScore(b, project) - candidateScore(a, project)
  if (scoreDiff !== 0) return scoreDiff
  if (a.area !== b.area) return a.area === 'main' ? -1 : 1
  if (a.order !== b.order) return a.order - b.order
  if (a.row !== b.row) return a.row - b.row
  return a.col - b.col
}

export function findPanelGridDuplicateFindings(
  project: ProjectWithOptionalV2Electrical,
  candidates: PanelGridDuplicateCandidate[],
): PanelGridDuplicateFinding[] {
  const findings: PanelGridDuplicateFinding[] = []
  const dedupedCandidates: PanelGridDuplicateCandidate[] = []

  const byModuleKey = new Map<string, PanelGridDuplicateCandidate[]>()
  for (const candidate of candidates) {
    const key = panelGridModuleRefKey(candidate.ref)
    const group = byModuleKey.get(key)
    if (group) group.push(candidate)
    else byModuleKey.set(key, [candidate])
  }

  for (const group of byModuleKey.values()) {
    const sorted = [...group].sort((a, b) => compareCandidates(a, b, project))
    const keep = sorted[0]
    if (!keep) continue
    dedupedCandidates.push(keep)
    const remove = sorted.slice(1)
    if (remove.length === 0) continue
    const info = getModuleDisplayInfo(keep.ref, project)
    findings.push({
      reason: 'duplicateRef',
      summaryLabel: info.label.trim() || panelGridModuleRefKey(keep.ref),
      keep,
      remove,
      hideModuleKeys: [],
    })
  }

  const byVisibleLabel = new Map<string, PanelGridDuplicateCandidate[]>()
  for (const candidate of dedupedCandidates) {
    const info = getModuleDisplayInfo(candidate.ref, project)
    const normalizedLabel = normalizeVisibleLabel(info.label)
    if (!normalizedLabel) continue
    const group = byVisibleLabel.get(normalizedLabel)
    if (group) group.push(candidate)
    else byVisibleLabel.set(normalizedLabel, [candidate])
  }

  for (const group of byVisibleLabel.values()) {
    if (group.length < 2) continue
    if (!group.some((candidate) => candidate.ref.kind === 'protection')) continue

    const sorted = [...group].sort((a, b) => compareCandidates(a, b, project))
    const keep = sorted[0]
    if (!keep) continue

    const remove = sorted.filter(
      (candidate) => panelGridModuleRefKey(candidate.ref) !== panelGridModuleRefKey(keep.ref),
    )
    if (remove.length === 0) continue

    const info = getModuleDisplayInfo(keep.ref, project)
    findings.push({
      reason: 'duplicateVisibleLabel',
      summaryLabel: info.label.trim() || panelGridModuleRefKey(keep.ref),
      keep,
      remove,
      hideModuleKeys: [...new Set(remove.map((candidate) => panelGridModuleRefKey(candidate.ref)))],
    })
  }

  return findings
}

function isFeedPathProtectionTrunkRef(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical,
): boolean {
  if (ref.kind !== 'trunkDevice') return false
  const device = findTrunkDeviceInProject(project, ref.id)
  return device?.type === 'protection'
}

/**
 * Same visible letter on a bus protection and a feed-path protection (supply strip or
 * incoming PANEL circuit) is a naming conflict, not a structural panel-grid orphan.
 */
export function isSupplyBusProtectionLabelCollision(
  finding: PanelGridDuplicateFinding,
  project: ProjectWithOptionalV2Electrical,
): boolean {
  if (finding.reason !== 'duplicateVisibleLabel') return false
  const candidates = [finding.keep, ...finding.remove]
  let hasBusProtection = false
  let hasFeedPathProtection = false
  for (const candidate of candidates) {
    if (candidate.ref.kind === 'protection') {
      hasBusProtection = true
    } else if (isFeedPathProtectionTrunkRef(candidate.ref, project)) {
      hasFeedPathProtection = true
    }
  }
  return hasBusProtection && hasFeedPathProtection
}

export function getSuppressedPanelGridModuleKeys(
  project: ProjectWithOptionalV2Electrical,
  candidates: PanelGridDuplicateCandidate[],
): Set<string> {
  const suppressed = new Set<string>()
  for (const finding of findPanelGridDuplicateFindings(project, candidates)) {
    if (finding.reason !== 'duplicateVisibleLabel') continue
    for (const key of finding.hideModuleKeys) {
      suppressed.add(key)
    }
  }
  return suppressed
}
