import { polesConfigToDisplay } from '@/constants/poleConfig'
import type { Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'
import i18n from '@/i18n'
import { findTrunkDeviceInProject } from '@/utils/project'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'

function findProtectionRecursive(panels: Panel[], id: string): ProtectionDevice | null {
  for (const p of panels) {
    const pr = p.protections.find((x) => x.id === id)
    if (pr) return pr
    const inSub = findProtectionRecursive(p.subPanels ?? [], id)
    if (inSub) return inSub
  }
  return null
}

function findEndpointRecursive(panels: Panel[], id: string): import('@/types/schema').Endpoint | null {
  for (const p of panels) {
    for (const c of p.circuits ?? []) {
      const ep = c.endpoints.find((e) => e.id === id)
      if (ep) return ep
    }
    for (const pr of p.protections) {
      for (const c of pr.circuits ?? []) {
        const ep = c.endpoints.find((e) => e.id === id)
        if (ep) return ep
      }
    }
    const inSub = findEndpointRecursive(p.subPanels ?? [], id)
    if (inSub) return inSub
  }
  return null
}

function findParentPanel(panels: Panel[], protectionId: string): Panel | null {
  for (const p of panels) {
    if (p.protections.some((pr) => pr.id === protectionId)) return p
    const inSub = findParentPanel(p.subPanels ?? [], protectionId)
    if (inSub) return inSub
  }
  return null
}

function countCircuitEndpoints(pr: ProtectionDevice): number {
  let count = 0
  for (const c of pr.circuits ?? []) {
    count += c.endpoints.length
  }
  return count
}

export interface ModuleDisplayInfo {
  label: string
  specLines: string[]
  tooltipText: string
  kind: 'protection' | 'trunkDevice' | 'domotica'
}

function buildProtectionTooltip(
  pr: ProtectionDevice,
  project: ProjectWithOptionalV2Electrical,
  refId: string
): string {
  const lines: string[] = [pr.label]

  // Full type & specs line
  const specParts: string[] = [pr.type]
  if (pr.curve) specParts.push(pr.curve)
  if (pr.ratingA != null) specParts.push(`${pr.ratingA}A`)
  if (pr.sensitivityMa != null) specParts.push(`IΔn ${pr.sensitivityMa}mA`)
  if (pr.residualCurrentType) specParts.push(`Type ${pr.residualCurrentType}`)
  if (pr.breakingCapacityKa != null) specParts.push(`${pr.breakingCapacityKa}kA`)
  if (pr.polesConfig) specParts.push(polesConfigToDisplay(pr.polesConfig) || pr.polesConfig)
  lines.push(specParts.join(' '))

  // Children
  const circuitCount = pr.circuits?.length ?? 0
  const endpointCount = countCircuitEndpoints(pr)
  if (circuitCount > 0) {
    const parts = [`${circuitCount} circuit${circuitCount !== 1 ? 's' : ''}`]
    if (endpointCount > 0) parts.push(`${endpointCount} endpoint${endpointCount !== 1 ? 's' : ''}`)
    lines.push(parts.join(', '))
  }

  // Sub-panel connection
  const panels = getElectricalPanelsFromProject(project)
  if (pr.subPanelId) {
    const subPanel = findPanelById(panels, pr.subPanelId)
    if (subPanel) lines.push(`→ ${subPanel.name}`)
  }

  // Parent panel
  const parent = findParentPanel(panels, refId)
  if (parent) lines.push(`Panel: ${parent.name}`)

  if (pr.notes) lines.push(pr.notes)

  return lines.join('\n')
}

export function getModuleDisplayInfo(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null,
): ModuleDisplayInfo {
  const empty: ModuleDisplayInfo = { label: '', specLines: [], tooltipText: '', kind: ref.kind }
  if (!project) return empty

  if (ref.kind === 'protection') {
    const pr = findProtectionRecursive(getElectricalPanelsFromProject(project), ref.id)
    if (!pr) return { ...empty, label: ref.id }

    const specLines: string[] = []

    switch (pr.type) {
      case 'MCB': {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        if (pr.curve) specLines.push(pr.curve)
        if (pr.breakingCapacityKa != null) specLines.push(`${pr.breakingCapacityKa}kA`)
        break
      }
      case 'RCD': {
        if (pr.sensitivityMa != null) specLines.push(`IΔn ${pr.sensitivityMa}mA`)
        if (pr.residualCurrentType) specLines.push(`Type ${pr.residualCurrentType}`)
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
      case 'RCBO': {
        if (pr.sensitivityMa != null) specLines.push(`IΔn ${pr.sensitivityMa}mA`)
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        if (pr.curve) specLines.push(pr.curve)
        if (pr.breakingCapacityKa != null) specLines.push(`${pr.breakingCapacityKa}kA`)
        break
      }
      case 'FUSE': {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
      case 'MAIN_SWITCH': {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
      case 'SPD': {
        specLines.push('SPD')
        break
      }
      default: {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
    }

    return {
      // For panel modules, respect the explicit label; keep it empty until
      // the circuit actually has endpoints and the store assigns a label.
      label: pr.label,
      specLines,
      tooltipText: buildProtectionTooltip(pr, project, ref.id),
      kind: 'protection',
    }
  }

  if (ref.kind === 'trunkDevice') {
    const d = findTrunkDeviceInProject(project, ref.id)
    if (!d) return { ...empty, label: ref.id }

    const specLines: string[] = []
    const tooltipParts: string[] = []

    if (d.type === 'protection' && d.protectionType) {
      switch (d.protectionType) {
        case 'MCB': {
          if (d.ratingA != null) specLines.push(`${d.ratingA}A`)
          if (d.curve) specLines.push(d.curve)
          if (d.breakingCapacityKa != null) specLines.push(`${d.breakingCapacityKa}kA`)
          break
        }
        case 'RCD': {
          if (d.sensitivityMa != null) specLines.push(`IΔn ${d.sensitivityMa}mA`)
          if (d.residualCurrentType) specLines.push(`Type ${d.residualCurrentType}`)
          break
        }
        case 'RCBO': {
          if (d.sensitivityMa != null) specLines.push(`IΔn ${d.sensitivityMa}mA`)
          if (d.ratingA != null) specLines.push(`${d.ratingA}A`)
          if (d.curve) specLines.push(d.curve)
          break
        }
        case 'SPD': {
          if (d.breakingCapacityKa != null) specLines.push(`${d.breakingCapacityKa}kA`)
          break
        }
        default: {
          if (d.ratingA != null) specLines.push(`${d.ratingA}A`)
          break
        }
      }
      const polesDisplay = d.polesConfig ? polesConfigToDisplay(d.polesConfig) : ''
      const typeLabel = i18n.t(`protections.type_${d.protectionType}`, { defaultValue: d.protectionType })
      const specStr = [
        typeLabel,
        d.curve,
        d.ratingA != null ? `${d.ratingA}A` : '',
        d.sensitivityMa != null ? `IΔn ${d.sensitivityMa}mA` : '',
        d.breakingCapacityKa != null ? `${d.breakingCapacityKa}kA` : '',
        polesDisplay,
      ]
        .filter(Boolean)
        .join(' ')
      tooltipParts.push(specStr)
      if (d.label && d.label.trim().length > 0) {
        tooltipParts.unshift(d.label)
      } else {
        tooltipParts.unshift(typeLabel)
      }
    } else {
      const typeName = d.type.replace(/_/g, ' ')
      tooltipParts.push(typeName)
      if (d.polesConfig) tooltipParts.push(polesConfigToDisplay(d.polesConfig) || d.polesConfig)
    }

    if (d.notes) tooltipParts.push(d.notes)

    const visibleLabel =
      (d.label && d.label.trim().length > 0
        ? d.label
        : d.type === 'protection' && d.protectionType
          ? i18n.t(`protections.type_${d.protectionType}`, { defaultValue: d.protectionType })
          : d.type.replace(/_/g, ' ')) || ''

    return {
      label: visibleLabel,
      specLines,
      tooltipText: tooltipParts.join('\n'),
      kind: 'trunkDevice',
    }
  }

  if (ref.kind === 'domotica') {
    const ep = findEndpointRecursive(getElectricalPanelsFromProject(project), ref.endpointId)
    if (!ep) return { ...empty, label: ref.endpointId }

    const tooltipParts: string[] = [ep.label]
    const typeName = ep.type.replace(/_/g, ' ')
    if (ep.symbol) {
      tooltipParts.push(`${typeName} (${ep.symbol.replace(/_/g, ' ')})`)
    } else {
      tooltipParts.push(typeName)
    }
    if (ep.notes) tooltipParts.push(ep.notes)

    return {
      label: ep.label,
      specLines: [],
      tooltipText: tooltipParts.join('\n'),
      kind: 'domotica',
    }
  }

  return empty
}
