/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { BottomUpLayoutResult, BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import type { Circuit, Endpoint, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import {
  formatInstallYearLabel,
  getEffectiveInstallYear,
  getExplicitInstallYear,
  getInstallYearFrameYear,
  installYearColor,
  isInstallationDateSuppressed,
  isOldInstallYear,
  type ProjectWithOptionalInstallYear,
} from '@/lib/installDates'
import type { ResolvedFrameItem } from '@/lib/eendraad/frameContent'
import { computeEendraadFrameBounds, type EendraadFrameBounds } from '@/lib/eendraad/frameBounds'
import {
  getInstallDateTargetInheritedYear,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import {
  buildCircuitGraphIndex,
  collectPanelTreeSubCircuitIds,
  resolveCircuitReference,
  type CircuitGraphIndex,
} from '@/lib/eendraad/circuitGraph'
import {
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinksForSourcePanel,
} from '@/lib/eendraad/panelSupplyLink'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

type DateEntity = Panel | ProtectionDevice | Circuit | Endpoint | TrunkDevice
type InstallDateOverlayProject = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalInstallYear & {
    project: {
      installDateColors?: Record<string, string>
    }
  }

interface InstallDateOverlayProps {
  project: InstallDateOverlayProject
  layout: BottomUpLayoutResult | null
  visible: boolean
  monochrome: boolean
  selectionEnabled: boolean
  onSelectFrame?: (frame: {
    targets: InstallDateTarget[]
    year: number
    bounds: EendraadFrameBounds
  }) => void
}

export function isInstallDateOverlayInteractive(
  selectionEnabled: boolean,
  onSelectFrame: InstallDateOverlayProps['onSelectFrame']
): boolean {
  return selectionEnabled && typeof onSelectFrame === 'function'
}

export function isPrimaryInstallDateFrameClick(button?: number): boolean {
  return button == null || button === 0
}

interface DateFrame {
  id: string
  year: number
  label: string
  color: string
  itemCount: number
  x: number
  y: number
  width: number
  height: number
  labelX?: number
  labelY?: number
  labelWidth?: number
  relationBounds?: EendraadFrameBounds
  labelPlacement?: 'supplyProtection' | 'panel'
  borderless?: boolean
  targets: InstallDateTarget[]
}

interface DateCandidate {
  year: number
  item: ResolvedFrameItem
  bounds: EendraadFrameBounds
  relationBounds: EendraadFrameBounds
  forceSingle?: boolean
  targets?: InstallDateTarget[]
  labelPlacement?: 'supplyProtection'
  expandedFromParent?: boolean
}

interface DateBlocker {
  year: number
  item: ResolvedFrameItem
  bounds: EendraadFrameBounds
}

interface RectBounds {
  x: number
  y: number
  width: number
  height: number
}

function isEndpointEntity(entity: DateEntity): entity is Endpoint {
  return 'symbol' in entity
}

function containsBounds(outer: EendraadFrameBounds, inner: EendraadFrameBounds): boolean {
  const tolerance = 1
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  )
}

function rectsOverlap(a: RectBounds, b: RectBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function estimateOverlayTextWidth(text: string, fontSize: number): number {
  return Math.max(24, text.length * fontSize * 0.62)
}

function estimateRelationTextWidth(text: string, fontSize: number): number {
  return Math.max(18, text.length * fontSize * 0.52)
}

function lineRectBoundaryT(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: RectBounds
): number | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const hits: number[] = []
  if (Math.abs(dx) > 0.001) {
    hits.push((rect.x - from.x) / dx)
    hits.push((rect.x + rect.width - from.x) / dx)
  }
  if (Math.abs(dy) > 0.001) {
    hits.push((rect.y - from.y) / dy)
    hits.push((rect.y + rect.height - from.y) / dy)
  }
  const valid = hits
    .filter((t) => t >= 0 && t <= 1)
    .filter((t) => {
      const x = from.x + dx * t
      const y = from.y + dy * t
      return (
        x >= rect.x - 0.5 &&
        x <= rect.x + rect.width + 0.5 &&
        y >= rect.y - 0.5 &&
        y <= rect.y + rect.height + 0.5
      )
    })
  if (valid.length === 0) return null
  return Math.min(...valid)
}

function clippedRelationLine(
  labelRect: RectBounds,
  symbolRect: RectBounds
): [number, number, number, number] | null {
  const labelCenter = {
    x: labelRect.x + labelRect.width / 2,
    y: labelRect.y + labelRect.height / 2,
  }
  const symbolCenter = {
    x: symbolRect.x + symbolRect.width / 2,
    y: symbolRect.y + symbolRect.height / 2,
  }
  const labelExit = lineRectBoundaryT(labelCenter, symbolCenter, labelRect)
  const symbolEnter = lineRectBoundaryT(symbolCenter, labelCenter, symbolRect)
  if (labelExit == null || symbolEnter == null) return null
  const centerDistance = Math.hypot(symbolCenter.x - labelCenter.x, symbolCenter.y - labelCenter.y)
  if (centerDistance < 1) return null
  const marginT = Math.min(0.03, 0.5 / centerDistance)
  const startT = labelExit + marginT
  const endT = 1 - symbolEnter - marginT
  if (endT <= startT) return null
  const dx = symbolCenter.x - labelCenter.x
  const dy = symbolCenter.y - labelCenter.y
  return [
    labelCenter.x + dx * startT,
    labelCenter.y + dy * startT,
    labelCenter.x + dx * endT,
    labelCenter.y + dy * endT,
  ]
}

function buildLabelObstacles(panelLayout: BottomUpPanelLayout): RectBounds[] {
  return panelLayout.elements
    .filter((element) => element.type === 'label' && element.label?.trim())
    .map((element) => {
      const text = element.label ?? ''
      const width = Math.max(22, estimateOverlayTextWidth(text, 10))
      const vertical = element.height != null && element.height > (element.width ?? 0)
      if (vertical) {
        return {
          x: element.position.x - 8,
          y: element.position.y - Math.max(width, element.height ?? 0) / 2,
          width: 16,
          height: Math.max(width, element.height ?? 0),
        }
      }
      return {
        x: element.position.x - width / 2,
        y: element.position.y - 7,
        width,
        height: 16,
      }
    })
}

function shrinkFramePaddingCollisions(frames: DateFrame[]): DateFrame[] {
  const adjusted = frames.map((frame) => ({ ...frame }))
  const fitPaddingBetween = (before: DateFrame, after: DateFrame, axis: 'x' | 'y'): boolean => {
    const beforeContent = before.relationBounds!
    const afterContent = after.relationBounds!
    const size = axis === 'x' ? 'width' : 'height'
    const beforeContentEnd = beforeContent[axis] + beforeContent[size]
    const afterContentStart = afterContent[axis]
    const gap = Math.max(0, afterContentStart - beforeContentEnd)
    const beforeEnd = before[axis] + before[size]
    const beforePadding = Math.max(0, beforeEnd - beforeContentEnd)
    const afterPadding = Math.max(0, afterContentStart - after[axis])
    const paddingTotal = beforePadding + afterPadding
    if (paddingTotal <= gap || paddingTotal === 0) return false

    const nextBeforePadding = gap * (beforePadding / paddingTotal)
    const nextAfterPadding = gap - nextBeforePadding
    before[size] = beforeContentEnd + nextBeforePadding - before[axis]
    const afterEnd = after[axis] + after[size]
    after[axis] = afterContentStart - nextAfterPadding
    after[size] = afterEnd - after[axis]
    return true
  }

  // A few passes settle rows where one frame touches neighbours on both sides.
  for (let pass = 0; pass < Math.min(adjusted.length, 4); pass += 1) {
    let changed = false
    for (let index = 0; index < adjusted.length; index += 1) {
      const a = adjusted[index]!
      if (!a.relationBounds) continue
      for (let otherIndex = index + 1; otherIndex < adjusted.length; otherIndex += 1) {
        const b = adjusted[otherIndex]!
        if (!b.relationBounds || !rectsOverlap(a, b)) continue
        if (
          containsBounds(a.relationBounds, b.relationBounds) ||
          containsBounds(b.relationBounds, a.relationBounds)
        ) {
          continue
        }

        const aBottom = a.relationBounds.y + a.relationBounds.height
        const bBottom = b.relationBounds.y + b.relationBounds.height
        if (aBottom <= b.relationBounds.y) {
          changed = fitPaddingBetween(a, b, 'y') || changed
        } else if (bBottom <= a.relationBounds.y) {
          changed = fitPaddingBetween(b, a, 'y') || changed
        } else {
          const aRight = a.relationBounds.x + a.relationBounds.width
          const bRight = b.relationBounds.x + b.relationBounds.width
          if (aRight <= b.relationBounds.x) {
            changed = fitPaddingBetween(a, b, 'x') || changed
          } else if (bRight <= a.relationBounds.x) {
            changed = fitPaddingBetween(b, a, 'x') || changed
          }
        }
      }
    }
    if (!changed) break
  }

  return adjusted
}

function placeFrameLabels(frames: DateFrame[], panelLayout: BottomUpPanelLayout): DateFrame[] {
  const obstacles = buildLabelObstacles(panelLayout)
  const placedLabels: RectBounds[] = []
  const fontSize = 11
  return frames.map((frame) => {
    const isSingle = frame.itemCount <= 1
    const isOldInstallFrame = isOldInstallYear(frame.year)
    const textWidth = estimateOverlayTextWidth(frame.label, fontSize)
    const textHeight = fontSize + 2
    const gap = isSingle ? 3 : 14
    const singleAnchor = frame
    const preferredCandidates: Array<{ x: number; y: number }> =
      frame.labelPlacement === 'panel'
        ? [
            {
              x: frame.x + frame.width - textWidth,
              y: frame.y - textHeight - 2,
            },
          ]
        : frame.labelPlacement === 'supplyProtection'
        ? [
            { x: frame.x + frame.width / 2 - textWidth / 2, y: frame.y + frame.height + 2 },
            {
              x: frame.x + frame.width / 2 - textWidth / 2,
              y: frame.y + frame.height - textHeight - 2,
            },
            { x: frame.x + frame.width - textWidth, y: frame.y - gap },
          ]
        : isSingle
          ? [
              {
                x: singleAnchor.x + singleAnchor.width - 20,
                y: singleAnchor.y + singleAnchor.height * 0.18,
              },
              {
                x: singleAnchor.x + singleAnchor.width - 20,
                y: singleAnchor.y + singleAnchor.height * 0.34,
              },
              { x: singleAnchor.x + singleAnchor.width - textWidth + 10, y: singleAnchor.y + 4 },
              {
                x: singleAnchor.x + singleAnchor.width - textWidth + 10,
                y: singleAnchor.y + singleAnchor.height - textHeight - 2,
              },
              { x: singleAnchor.x - textWidth - 4, y: singleAnchor.y + singleAnchor.height * 0.2 },
              { x: singleAnchor.x + singleAnchor.width - textWidth, y: singleAnchor.y - gap },
            ]
          : isOldInstallFrame
            ? [
                { x: frame.x + frame.width - textWidth, y: frame.y - 14 },
                { x: frame.x + frame.width - textWidth, y: frame.y + 4 },
                { x: frame.x + frame.width - textWidth, y: frame.y + frame.height + 4 },
                { x: frame.x, y: frame.y - 14 },
                { x: frame.x - textWidth - 4, y: frame.y },
              ]
            : [
                { x: frame.x + frame.width - textWidth, y: frame.y - gap },
                { x: frame.x + frame.width + 3, y: frame.y + (frame.height - textHeight) / 2 },
                { x: frame.x + frame.width - textWidth, y: frame.y + frame.height + 2 },
                { x: frame.x + frame.width - textWidth, y: frame.y + 2 },
                { x: frame.x, y: frame.y - gap },
                { x: frame.x - textWidth - 3, y: frame.y + (frame.height - textHeight) / 2 },
              ]
    const candidates = [
      ...preferredCandidates,
      { x: frame.x + frame.width + 4, y: frame.y - textHeight - 2 },
      { x: frame.x - textWidth - 4, y: frame.y - textHeight - 2 },
      { x: frame.x + frame.width + 4, y: frame.y + frame.height + 2 },
      { x: frame.x - textWidth - 4, y: frame.y + frame.height + 2 },
    ]
    const frameContent = frame.relationBounds ?? frame
    const neighbouringFrames = frames.filter((other) => {
      if (other.id === frame.id || !other.relationBounds) return false
      return !(
        containsBounds(frameContent, other.relationBounds) ||
        containsBounds(other.relationBounds, frameContent)
      )
    })
    const oldSingleLeftShift =
      isSingle && isOldInstallFrame ? estimateOverlayTextWidth('2026', fontSize) : 0
    const chosen =
      candidates.find((candidate) => {
        const rect = {
          x: candidate.x - oldSingleLeftShift - 2,
          y: candidate.y - 2,
          width: textWidth + 4,
          height: textHeight + 4,
        }
        return ![...obstacles, ...placedLabels, ...neighbouringFrames].some((obstacle) =>
          rectsOverlap(rect, obstacle)
        )
      }) ?? candidates[0]!
    const labelX = chosen.x - oldSingleLeftShift
    const labelRect = {
      x: labelX - 2,
      y: chosen.y - 2,
      width: textWidth + 4,
      height: textHeight + 4,
    }
    placedLabels.push(labelRect)
    return {
      ...frame,
      labelX,
      labelY: chosen.y,
      labelWidth: textWidth,
    }
  })
}

function walkPanelDateEntities(
  graph: CircuitGraphIndex,
  panel: Panel,
  inheritedYear: number | undefined,
  visit: (
    entity: DateEntity,
    kind: ResolvedFrameItem['kind'] | 'panel',
    inheritedYear: number | undefined,
    inheritedSource: InstallDateTarget | undefined
  ) => void
) {
  const protectionFeeds = new Map<
    string,
    { year: number; source: InstallDateTarget | undefined }
  >()
  const panelTreeSubCircuitIds = collectPanelTreeSubCircuitIds(panel)
  const visitCircuit = (
    circuit: Circuit,
    parentYear: number | undefined,
    parentSource: InstallDateTarget | undefined,
    visited = new Set<string>()
  ) => {
    if (visited.has(circuit.id)) return
    visited.add(circuit.id)
    visit(circuit, 'endpoint', parentYear, parentSource)
    const circuitYear = getEffectiveInstallYear(null, circuit, parentYear)
    const circuitSource =
      getExplicitInstallYear(circuit) != null
        ? { id: circuit.id, type: 'circuit' as const }
        : parentSource
    for (const trunkDevice of circuit.trunkDevices ?? []) {
      visit(trunkDevice, 'trunkDevice', circuitYear, circuitSource)
    }
    for (const endpoint of circuit.endpoints) {
      visit(endpoint, 'endpoint', circuitYear, circuitSource)
    }
    for (const subCircuitId of circuit.subCircuitIds ?? []) {
      const referenceTarget = resolveCircuitReference(graph, subCircuitId)
      if (referenceTarget.kind === 'protection') {
        protectionFeeds.set(referenceTarget.protection.id, {
          year: circuitYear,
          source: circuitSource,
        })
      } else if (
        referenceTarget.kind === 'circuit' &&
        graph.canonicalOwnerByCircuitId.get(referenceTarget.circuit.id)?.panel.id === panel.id
      ) {
        visitCircuit(referenceTarget.circuit, circuitYear, circuitSource, visited)
      }
    }
  }

  visit(panel, 'panel', inheritedYear, undefined)
  const panelYear = getEffectiveInstallYear(null, panel, inheritedYear)
  const panelSource =
    getExplicitInstallYear(panel) != null
      ? { id: panel.id, type: 'panel' as const }
      : undefined

  for (const protection of panel.protections) {
    const protectionFeed = protectionFeeds.get(protection.id)
    const protectionInheritedYear = protectionFeed?.year ?? panelYear
    const protectionInheritedSource = protectionFeed?.source ?? panelSource
    visit(protection, 'protection', protectionInheritedYear, protectionInheritedSource)
    const protectionYear = getEffectiveInstallYear(null, protection, protectionInheritedYear)
    const protectionSource =
      getExplicitInstallYear(protection) != null
        ? { id: protection.id, type: 'protection' as const }
        : protectionInheritedSource
    for (const circuit of protection.circuits ?? []) {
      if (panelTreeSubCircuitIds.has(circuit.id) && !graph.protectedCircuitIds.has(circuit.id))
        continue
      visitCircuit(circuit, protectionYear, protectionSource)
    }
  }

  for (const circuit of panel.circuits) {
    if (panelTreeSubCircuitIds.has(circuit.id)) continue
    visitCircuit(circuit, panelYear, panelSource)
  }
}

function findEndpointInPanel(panel: Panel, endpointId: string): Endpoint | undefined {
  const scanCircuit = (circuit: Circuit) =>
    circuit.endpoints.find((endpoint) => endpoint.id === endpointId)
  for (const circuit of panel.circuits) {
    const found = scanCircuit(circuit)
    if (found) return found
  }
  for (const protection of panel.protections) {
    for (const circuit of protection.circuits ?? []) {
      const found = scanCircuit(circuit)
      if (found) return found
    }
  }
  for (const subPanel of panel.subPanels) {
    const found = findEndpointInPanel(subPanel, endpointId)
    if (found) return found
  }
  return undefined
}

function findPanelInProject(
  project: InstallDateOverlayProject,
  panelId: string
): Panel | undefined {
  const visit = (panels: Panel[]): Panel | undefined => {
    for (const panel of panels) {
      if (panel.id === panelId) return panel
      const found = visit(panel.subPanels)
      if (found) return found
    }
    return undefined
  }
  return visit(getProjectElectricalPanels(project))
}

function findPanelByNameInProject(
  project: InstallDateOverlayProject,
  name: string
): Panel | undefined {
  const visit = (panels: Panel[]): Panel | undefined => {
    for (const panel of panels) {
      if (panel.name === name || Object.values(panel.nameByLocale ?? {}).includes(name))
        return panel
      const found = visit(panel.subPanels)
      if (found) return found
    }
    return undefined
  }
  return visit(getProjectElectricalPanels(project))
}

export function buildDateFramesForPanel(
  project: InstallDateOverlayProject,
  panelLayout: BottomUpPanelLayout,
  monochrome: boolean,
  t: TFunction
): DateFrame[] {
  const graph = buildCircuitGraphIndex(project)
  const candidates: DateCandidate[] = []
  const blockers: DateBlocker[] = []
  const directPanelYears: number[] = []
  const getEndpoint = (id: string) => findEndpointInPanel(panelLayout.panel, id)
  const getCanonicalFrameItem = (item: ResolvedFrameItem): ResolvedFrameItem => {
    if (item.kind !== 'endpoint') return item

    // A linked panel endpoint is retained in the circuit graph for topology,
    // while layout adds a dedicated subpanel-symbol element for the same
    // painted symbol. Date candidates must use that one visual identity or
    // the endpoint and panel-symbol passes create two identical year labels.
    const panelSymbol = panelLayout.elements.find(
      (element) =>
        element.type === 'endpoint' &&
        element.id?.startsWith('subpanel-symbol-') &&
        element.endpointId === item.id
    )
    return panelSymbol ? { id: panelSymbol.id, kind: 'panelSymbol' } : item
  }
  const panelInheritedYear = getInstallDateTargetInheritedYear(project, {
    id: panelLayout.panel.id,
    type: 'panel',
  })
  const panelYear = getEffectiveInstallYear(project, panelLayout.panel, panelInheritedYear)
  const pushItem = (
    year: number,
    item: ResolvedFrameItem,
    options?: {
      forceSingle?: boolean
      targets?: InstallDateTarget[]
      labelPlacement?: 'supplyProtection'
      expandedFromParent?: boolean
    }
  ) => {
    const canonicalItem = getCanonicalFrameItem(item)
    const frameYear = getInstallYearFrameYear(year)
    const existingCandidate = candidates.find(
      (candidate) =>
        candidate.item.id === canonicalItem.id &&
        candidate.item.kind === canonicalItem.kind &&
        getInstallYearFrameYear(candidate.year) === frameYear
    )
    if (existingCandidate) {
      if (options?.targets) existingCandidate.targets = options.targets
      if (options?.forceSingle) existingCandidate.forceSingle = true
      if (options?.labelPlacement) existingCandidate.labelPlacement = options.labelPlacement
      if (existingCandidate.expandedFromParent && !options?.expandedFromParent) {
        existingCandidate.expandedFromParent = false
      }
      return
    }
    const bounds = computeEendraadFrameBounds({
      items: [canonicalItem],
      panelLayout,
      getEndpointById: getEndpoint,
      includeEndpointLabels: false,
    })
    const relationBounds = computeEendraadFrameBounds({
      items: [canonicalItem],
      panelLayout,
      getEndpointById: getEndpoint,
      padding: 0,
      includeEndpointLabels: false,
    })
    if (!bounds || !relationBounds) return
    candidates.push({
      year,
      item: canonicalItem,
      bounds,
      relationBounds,
      forceSingle: options?.forceSingle,
      targets: options?.targets,
      labelPlacement: options?.labelPlacement,
      expandedFromParent: options?.expandedFromParent,
    })
  }
  const pushBlocker = (year: number, item: ResolvedFrameItem) => {
    const alreadyExists = blockers.some(
      (blocker) => blocker.item.id === item.id && blocker.item.kind === item.kind
    )
    if (alreadyExists) return
    const bounds = computeEendraadFrameBounds({
      items: [item],
      panelLayout,
      getEndpointById: getEndpoint,
      padding: 0,
      includeEndpointLabels: false,
    })
    if (!bounds) return
    blockers.push({ year, item, bounds })
  }

  walkPanelDateEntities(
    graph,
    panelLayout.panel,
    panelInheritedYear,
    (entity, kind, inheritedYear, inheritedSource) => {
      if (isInstallationDateSuppressed(entity)) return
      const explicitYear = getExplicitInstallYear(entity)
      const year = getEffectiveInstallYear(project, entity, inheritedYear)
      const entityTarget: InstallDateTarget =
        kind === 'panel'
          ? { id: entity.id, type: 'panel' }
          : kind === 'endpoint' && 'endpoints' in entity
            ? { id: entity.id, type: 'circuit' }
            : kind === 'protection'
              ? { id: entity.id, type: 'protection' }
              : kind === 'trunkDevice'
                ? { id: entity.id, type: 'trunkDevice' }
                : { id: entity.id, type: 'endpoint' }
      const dateSource = explicitYear != null ? entityTarget : inheritedSource

      if (kind === 'panel') {
        if (explicitYear != null) directPanelYears.push(year)
        return
      }
      if (kind === 'protection') {
        pushBlocker(year, { id: entity.id, kind: 'protection' })
      } else if (kind === 'trunkDevice') {
        pushBlocker(year, { id: entity.id, kind: 'trunkDevice' })
      } else if (kind === 'endpoint') {
        if ('endpoints' in entity) {
          for (const endpoint of entity.endpoints) {
            // A circuit date is inherited only by endpoints without a more specific
            // override. Recording the parent year here made the later endpoint visit
            // look like a conflicting date and fragmented adjacent branch groups.
            const endpointYear = getEffectiveInstallYear(project, endpoint, year)
            pushBlocker(endpointYear, { id: endpoint.id, kind: 'endpoint' })
          }
        } else {
          pushBlocker(year, { id: entity.id, kind: 'endpoint' })
        }
      }
      if (kind === 'endpoint' && isEndpointEntity(entity)) {
        const linkedPanel =
          entity.symbol === 'panel_distribution' && entity.panelId
            ? findPanelInProject(project, entity.panelId)
            : entity.symbol === 'panel_distribution'
              ? findPanelByNameInProject(project, entity.label)
              : undefined
        const linkedPanelExplicitYear = getExplicitInstallYear(linkedPanel)
        if (linkedPanel && linkedPanelExplicitYear != null) {
          pushItem(
            getEffectiveInstallYear(project, linkedPanel),
            { id: entity.id, kind: 'endpoint' },
            { forceSingle: true }
          )
          return
        }
      }

      const inheritedOverrideYear =
        explicitYear == null && inheritedYear != null && inheritedYear !== panelYear
      const redundantExplicitYear =
        explicitYear != null &&
        inheritedYear != null &&
        inheritedSource != null &&
        getInstallYearFrameYear(explicitYear) === getInstallYearFrameYear(inheritedYear)
      if (redundantExplicitYear || (explicitYear == null && !inheritedOverrideYear)) return

      if (kind === 'protection') {
        pushItem(year, { id: entity.id, kind: 'protection' }, {
          targets: dateSource ? [dateSource] : undefined,
        })
      } else if (kind === 'trunkDevice') {
        pushItem(year, { id: entity.id, kind: 'trunkDevice' }, {
          targets: dateSource ? [dateSource] : undefined,
        })
      } else if (kind === 'endpoint') {
        if ('endpoints' in entity) {
          for (const endpoint of entity.endpoints) {
            if (isInstallationDateSuppressed(endpoint)) continue
            const endpointYear = getEffectiveInstallYear(project, endpoint, year)
            if (getInstallYearFrameYear(endpointYear) === getInstallYearFrameYear(year)) {
              pushItem(year, { id: endpoint.id, kind: 'endpoint' }, {
                targets: dateSource ? [dateSource] : undefined,
                expandedFromParent: true,
              })
            }
          }
        } else if (explicitYear != null) {
          pushItem(year, { id: entity.id, kind: 'endpoint' }, {
            targets: [entityTarget],
          })
        }
      }
    }
  )

  for (const { device, feedScope } of panelLayout.supplyDevices ?? []) {
    if (feedScope === 'shared') continue
    const explicitYear = getExplicitInstallYear(device)
    if (explicitYear == null) continue
    pushItem(
      getEffectiveInstallYear(project, device),
      { id: device.id, kind: 'trunkDevice' },
      { labelPlacement: 'supplyProtection' }
    )
  }

  for (const { device } of panelLayout.groundDevices ?? []) {
    const explicitYear = getExplicitInstallYear(device)
    if (explicitYear == null) continue
    pushItem(getEffectiveInstallYear(project, device), { id: device.id, kind: 'trunkDevice' })
  }

  const addLinkedPanelSymbolMarkers = (panels: Panel[]) => {
    for (const panel of panels) {
      const explicitYear = getExplicitInstallYear(panel)
      if (explicitYear != null) {
        const link = resolvePanelSupplyLinkForPanel(project, panel.id)
        if (link?.sourcePanel.id === panelLayout.panel.id && link.sourcePanelEndpoint) {
          pushItem(
            getEffectiveInstallYear(project, panel),
            {
              id: link.sourcePanelEndpoint.id,
              kind: 'endpoint',
            },
            { forceSingle: true }
          )
        }
      }
      addLinkedPanelSymbolMarkers(panel.subPanels)
    }
  }
  addLinkedPanelSymbolMarkers(getProjectElectricalPanels(project))

  for (const link of resolvePanelSupplyLinksForSourcePanel(project, panelLayout.panel)) {
    const targetYear = getExplicitInstallYear(link.targetPanel)
    if (targetYear == null) continue
    const symbolElement = panelLayout.elements.find(
      (element) =>
        element.id === `subpanel-symbol-${link.protection.id}` && element.type === 'endpoint'
    )
    if (!symbolElement && !link.sourcePanelEndpoint) continue
    const item = symbolElement
      ? { id: symbolElement.id, kind: 'panelSymbol' as const }
      : { id: link.sourcePanelEndpoint!.id, kind: 'endpoint' as const }
    pushItem(getEffectiveInstallYear(project, link.targetPanel), item, {
      forceSingle: true,
      targets: [{ id: link.targetPanel.id, type: 'panel' }],
    })
  }

  const frames: DateFrame[] = []
  const frameYears = [
    ...new Set(candidates.map((candidate) => getInstallYearFrameYear(candidate.year))),
  ]
  for (const year of frameYears) {
    const sameYear = candidates
      .filter((candidate) => getInstallYearFrameYear(candidate.year) === year)
      .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
    const forcedSingle = sameYear.filter((candidate) => candidate.forceSingle)
    const groupableSameYear = sameYear.filter((candidate) => !candidate.forceSingle)
    const groups: ResolvedFrameItem[][] = []

    for (const candidate of groupableSameYear) {
      const targetGroup = groups.find((group) => {
        const proposed = [...group, candidate.item]
        const proposedItemKeys = new Set(proposed.map((item) => `${item.kind}:${item.id}`))
        // Group with the actual symbol geometry. Labels and visual padding belong to the
        // final frame; using them here fragments a clean run of equally dated branches.
        const proposedBounds = computeEendraadFrameBounds({
          items: proposed,
          panelLayout,
          getEndpointById: getEndpoint,
          includeEndpointLabels: false,
        })
        if (!proposedBounds) return false
        return (
          !candidates.some((other) => {
            const otherFrameYear = getInstallYearFrameYear(other.year)
            if (otherFrameYear === year) return false
            if (proposedItemKeys.has(`${other.item.kind}:${other.item.id}`)) return false
            return containsBounds(proposedBounds, other.relationBounds)
          }) &&
          !blockers.some((blocker) => {
            const blockerFrameYear = getInstallYearFrameYear(blocker.year)
            if (blockerFrameYear === year) return false
            if (proposedItemKeys.has(`${blocker.item.kind}:${blocker.item.id}`)) return false
            return containsBounds(proposedBounds, blocker.bounds)
          })
        )
      })
      if (targetGroup) {
        targetGroup.push(candidate.item)
      } else {
        groups.push([candidate.item])
      }
    }

    forcedSingle.forEach((candidate, index) => {
      frames.push({
        id: `${panelLayout.panel.id}-${year}-linked-panel-${index}`,
        year,
        label: formatInstallYearLabel(year, t),
        color: installYearColor(year, monochrome, project.project.installDateColors),
        itemCount: 1,
        relationBounds: candidate.relationBounds,
        labelPlacement: candidate.labelPlacement,
        targets:
          candidate.targets ??
          (candidate.item.kind === 'panelSymbol'
            ? []
            : [{ id: candidate.item.id, type: 'endpoint' }]),
        ...candidate.bounds,
      })
    })

    groups.forEach((items, index) => {
      const oldInstallGroup = isOldInstallYear(year)
      const itemHasMoreSpecificDifferentDateCandidate = (item: ResolvedFrameItem) => {
        const hasDirectCurrentCandidate = candidates.some(
          (candidate) =>
            candidate.item.id === item.id &&
            candidate.item.kind === item.kind &&
            getInstallYearFrameYear(candidate.year) === year &&
            candidate.expandedFromParent !== true
        )
        if (hasDirectCurrentCandidate) return false
        return candidates.some(
          (candidate) =>
            candidate.item.id === item.id &&
            candidate.item.kind === item.kind &&
            getInstallYearFrameYear(candidate.year) !== year &&
            candidate.expandedFromParent !== true
        )
      }
      const groupingBounds = computeEendraadFrameBounds({
        items,
        panelLayout,
        getEndpointById: getEndpoint,
        includeEndpointLabels: false,
      })
      const bounds = oldInstallGroup
        ? computeEendraadFrameBounds({
            items,
            panelLayout,
            getEndpointById: getEndpoint,
            includeEndpointLabels: false,
          })
        : groupingBounds
      const relationBounds = computeEendraadFrameBounds({
        items,
        panelLayout,
        getEndpointById: getEndpoint,
        padding: 0,
        includeEndpointLabels: false,
      })
      if (!bounds) return
      frames.push({
        id: `${panelLayout.panel.id}-${year}-${index}`,
        year,
        label: formatInstallYearLabel(year, t),
        color: installYearColor(year, monochrome, project.project.installDateColors),
        itemCount: items.length,
        relationBounds: relationBounds ?? bounds,
        targets: items.reduce<InstallDateTarget[]>((targets, item) => {
          if (item.kind === 'ground' || item.kind === 'panelSymbol') return targets
          if (itemHasMoreSpecificDifferentDateCandidate(item)) return targets
          const candidateTargets = candidates
            .filter(
              (candidate) =>
                candidate.item.id === item.id &&
                candidate.item.kind === item.kind &&
                getInstallYearFrameYear(candidate.year) === year
            )
            .flatMap((candidate) => candidate.targets ?? [])
          const targetsToAdd =
            candidateTargets.length > 0
              ? candidateTargets
              : [{ id: item.id, type: item.kind as InstallDateTarget['type'] }]
          for (const target of targetsToAdd) {
            if (
              !targets.some(
                (existing) => existing.id === target.id && existing.type === target.type
              )
            ) {
              targets.push(target)
            }
          }
          return targets
        }, []),
        ...bounds,
      })
    })
  }

  for (const year of directPanelYears) {
    frames.push({
      id: `${panelLayout.panel.id}-${year}-panel`,
      year,
      label: formatInstallYearLabel(year, t),
      color: installYearColor(year, monochrome, project.project.installDateColors),
      itemCount: 2,
      borderless: true,
      labelPlacement: 'panel',
      targets: [{ id: panelLayout.panel.id, type: 'panel' }],
      x: panelLayout.frame.x,
      y: panelLayout.frame.y,
      width: panelLayout.frame.width,
      height: panelLayout.frame.height,
    })
  }

  return placeFrameLabels(shrinkFramePaddingCollisions(frames), panelLayout)
}

const InstallDateOverlay = memo(function InstallDateOverlay({
  project,
  layout,
  visible,
  monochrome,
  selectionEnabled,
  onSelectFrame,
}: InstallDateOverlayProps) {
  const { t } = useTranslation()
  const frames = useMemo(() => {
    if (!visible || !layout) return []
    return layout.panels.flatMap((panelLayout) =>
      buildDateFramesForPanel(project, panelLayout, monochrome, t)
    )
  }, [layout, monochrome, project, t, visible])

  if (!visible || frames.length === 0) return null

  const interactive = isInstallDateOverlayInteractive(selectionEnabled, onSelectFrame)

  return (
    <Group listening={interactive} name="install-date-overlay">
      {frames.map((frame) => {
        const isSingle = frame.itemCount <= 1
        const drawsRelationLine = !frame.borderless && (isSingle || isOldInstallYear(frame.year))
        const fontSize = 11
        const textWidth = frame.labelWidth ?? estimateOverlayTextWidth(frame.label, fontSize)
        const labelX = frame.labelX ?? frame.x + frame.width - textWidth
        const labelY = frame.labelY ?? frame.y - (isSingle ? 13 : 20)
        const textHeight = fontSize + 2
        const relationTextWidth = Math.min(
          textWidth,
          estimateRelationTextWidth(frame.label, fontSize)
        )
        const labelRect = {
          x: labelX,
          y: labelY + 1,
          width: relationTextWidth,
          height: textHeight,
        }
        const relationLine = drawsRelationLine
          ? clippedRelationLine(
              labelRect,
              frame.relationBounds ?? {
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height,
              }
            )
          : null
        const hitPad = 7
        const borderHits = [
          {
            x: frame.x - hitPad,
            y: frame.y - hitPad,
            width: frame.width + hitPad * 2,
            height: hitPad * 2,
          },
          {
            x: frame.x - hitPad,
            y: frame.y + frame.height - hitPad,
            width: frame.width + hitPad * 2,
            height: hitPad * 2,
          },
          {
            x: frame.x - hitPad,
            y: frame.y - hitPad,
            width: hitPad * 2,
            height: frame.height + hitPad * 2,
          },
          {
            x: frame.x + frame.width - hitPad,
            y: frame.y - hitPad,
            width: hitPad * 2,
            height: frame.height + hitPad * 2,
          },
        ]
        const selectFrame = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
          const button = 'button' in event.evt ? event.evt.button : undefined
          if (!interactive || !onSelectFrame || !isPrimaryInstallDateFrameClick(button)) return
          event.cancelBubble = true
          onSelectFrame({
            targets: frame.targets,
            year: frame.year,
            bounds: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          })
        }
        return (
          <Group key={frame.id} listening={interactive}>
            {!isSingle && !frame.borderless ? (
              <>
                <Rect
                  x={frame.x}
                  y={frame.y}
                  width={frame.width}
                  height={frame.height}
                  stroke={frame.color}
                  strokeWidth={1.5}
                  dash={[7, 5]}
                  opacity={0.55}
                  cornerRadius={4}
                  listening={false}
                />
                {borderHits.map((hit, index) => (
                  <Rect
                    key={index}
                    {...hit}
                    fill="transparent"
                    onClick={selectFrame}
                    onTap={selectFrame}
                  />
                ))}
              </>
            ) : null}
            {relationLine ? (
              <Line
                points={relationLine}
                stroke={frame.color}
                strokeWidth={1}
                dash={[4, 3]}
                opacity={0.75}
                listening={false}
              />
            ) : null}
            <Text
              x={labelX}
              y={labelY}
              text={frame.label}
              fill={frame.color}
              fontSize={fontSize}
              width={textWidth}
              align="right"
              fontStyle="600"
              opacity={0.72}
              onClick={selectFrame}
              onTap={selectFrame}
            />
          </Group>
        )
      })}
    </Group>
  )
})

export default InstallDateOverlay
