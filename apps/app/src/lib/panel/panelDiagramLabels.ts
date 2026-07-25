import type { TFunction } from 'i18next'
import { normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import type { EarthingSystemType, Installation, Panel } from '@/types/schema'
import { resolveEffectiveEarthingSystem } from '@/lib/panel/panelEarthingSync'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import { getPanelDisplayName } from '@/utils/panelNames'

type PanelDiagramProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building & {
  project?: {
    id?: string
    name?: string
    locale?: string
  }
}

export const EARTHING_SYSTEM_VALUES = ['TT', 'TN-S', 'TN-C', 'TN-C-S', 'IT'] as const

export const DEFAULT_GRID_FREQUENCY_HZ = 50

/** Matches Konva header line spacing in PanelFrame. */
export const PANEL_DIAGRAM_HEADER_LINE_HEIGHT = 18

/** Vertical offset from frame top to first header line (PanelFrame titleY). */
export const PANEL_FRAME_HEADER_TOP_INSET = 10

/** Gap between last header line and schematic content (minY). */
export const PANEL_FRAME_HEADER_BOTTOM_CLEARANCE = 24

/** Base top inset in bottomUpLayout for a short single-line title. */
export const PANEL_FRAME_TITLE_PADDING_BASE = 28

/** Depth-first panel order: mains at each level, then nested sub-panels. */
export function orderPanelsForNumbering(panels: Panel[]): Panel[] {
  const result: Panel[] = []
  const visit = (list: Panel[]) => {
    for (const panel of list) {
      result.push(panel)
      visit(panel.subPanels ?? [])
    }
  }
  visit(panels)
  return result
}

export function formatPanelCode(sequenceIndex: number): string {
  return `B${String(sequenceIndex + 1).padStart(2, '0')}`
}

export function findParentPanel(panels: Panel[], childId: string): Panel | null {
  for (const panel of panels) {
    if ((panel.subPanels ?? []).some((sub) => sub.id === childId)) return panel
    const nested = findParentPanel(panel.subPanels ?? [], childId)
    if (nested) return nested
  }
  return null
}

export function buildPanelNumberIndexById(panels: Panel[]): Map<string, number> {
  const ordered = orderPanelsForNumbering(panels)
  return new Map(ordered.map((panel, index) => [panel.id, index]))
}

function formatNetVoltagePart(installation: Installation): string {
  const nv = installation.nominalVoltage
  const system = normalizeNominalVoltageSystem(nv.system)
  const uLn = Math.round(nv.uLineToNeutral)
  const uLl = Math.round(nv.uLineToLine)
  if (system === '3N~' || system === '1N~') {
    return `${system} ${uLl}/${uLn} V`
  }
  if (system === '3~' || system === '2~') {
    return `${system} ${uLl} V`
  }
  if (system === 'DC') {
    return `DC ${uLl} V`
  }
  return `${system} ${uLl} V`
}

function formatEarthingLabel(earthing: EarthingSystemType, t: TFunction): string {
  return t(`panels.earthingSystem.${earthing}`, earthing)
}

export type PanelDiagramHeaderLine = {
  text: string
  variant: 'title' | 'body' | 'muted'
}

export function isPanelNumberingActive(
  installation: Installation,
  advancedLabelsEnabled: boolean
): boolean {
  return advancedLabelsEnabled && !!installation.panelNumberingEnabled
}

export function isPanelNetLabelsActive(
  installation: Installation,
  advancedLabelsEnabled: boolean
): boolean {
  return advancedLabelsEnabled && !!installation.panelNetTypeLabelsEnabled
}

/** Extra top padding for the panel frame from multi-line diagram headers. */
export function getPanelFrameTitlePadding(
  panel: Panel,
  installation: Installation,
  rootPanels: Panel[]
): number {
  const project: PanelDiagramProject = {
    installation,
    panels: rootPanels,
    project: { locale: 'nl-BE' },
  }
  const lineCount = buildPanelDiagramHeaderLines(project, panel, ((key, opts) => {
    if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
      return String((opts as { defaultValue?: string }).defaultValue ?? key)
    }
    return key
  }) as TFunction, {
    advancedLabelsEnabled: true,
    numberIndexById: buildPanelNumberIndexById(rootPanels),
    parentPanel: findParentPanel(rootPanels, panel.id),
  }).length
  const netLabelsActive = !!installation.panelNetTypeLabelsEnabled

  const required =
    PANEL_FRAME_HEADER_TOP_INSET +
    lineCount * PANEL_DIAGRAM_HEADER_LINE_HEIGHT +
    PANEL_FRAME_HEADER_BOTTOM_CLEARANCE

  if (!netLabelsActive && lineCount <= 2) {
    return PANEL_FRAME_TITLE_PADDING_BASE
  }
  return Math.max(PANEL_FRAME_TITLE_PADDING_BASE, required)
}

export function buildPanelDiagramHeaderLines(
  project: PanelDiagramProject,
  panel: Panel,
  t: TFunction,
  options: {
    advancedLabelsEnabled: boolean
    parentPanel?: Panel | null
    numberIndexById?: Map<string, number>
  }
): PanelDiagramHeaderLine[] {
  const displayName = getPanelDisplayName(panel, project)
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) {
    return [{ text: displayName, variant: 'title' }]
  }
  const rootPanels = getElectricalPanelsFromProject(project)
  const numberingActive = isPanelNumberingActive(installation, options.advancedLabelsEnabled)
  const netLabelsActive = isPanelNetLabelsActive(installation, options.advancedLabelsEnabled)

  const numberIndexById =
    options.numberIndexById ?? buildPanelNumberIndexById(rootPanels)
  const panelIndex = numberIndexById.get(panel.id)
  const panelCode =
    panelIndex != null && numberingActive ? formatPanelCode(panelIndex) : null

  if (!numberingActive && !netLabelsActive) {
    const lines: PanelDiagramHeaderLine[] = [{ text: displayName, variant: 'title' }]
    if (panel.location?.trim()) {
      lines.push({ text: panel.location.trim(), variant: 'muted' })
    }
    return lines
  }

  const lines: PanelDiagramHeaderLine[] = []
  if (panelCode) {
    lines.push({
      text: t('panels.diagramTitleNumbered', {
        code: panelCode,
        name: displayName,
        defaultValue: `${panelCode} – ${displayName}`,
      }),
      variant: 'title',
    })
  } else {
    lines.push({ text: displayName, variant: 'title' })
  }

  if (!netLabelsActive) {
    return lines
  }

  const earthing = resolveEffectiveEarthingSystem(panel, rootPanels)
  if (!earthing) {
    return lines
  }

  const parent = options.parentPanel ?? findParentPanel(rootPanels, panel.id)
  const isSubPanel = parent != null

  if (isSubPanel && parent) {
    const parentIndex = numberIndexById.get(parent.id)
    const parentCode =
      parentIndex != null && numberingActive
        ? formatPanelCode(parentIndex)
        : getPanelDisplayName(parent, project)
    lines.push({
      text: t('panels.diagramFedFrom', {
        source: parentCode,
        defaultValue: `Fed from ${parentCode}`,
      }),
      variant: 'body',
    })
  }

  const netBase = formatNetVoltagePart(installation)
  if (isSubPanel && earthing) {
    lines.push({
      text: t('panels.diagramNetSecondary', {
        net: netBase,
        frequency: DEFAULT_GRID_FREQUENCY_HZ,
        earthing: formatEarthingLabel(earthing, t),
        defaultValue: `Net: ${netBase} – ${DEFAULT_GRID_FREQUENCY_HZ} Hz – ${earthing}`,
      }),
      variant: 'body',
    })
  } else {
    lines.push({
      text: t('panels.diagramNetMain', {
        net: netBase,
        frequency: DEFAULT_GRID_FREQUENCY_HZ,
        defaultValue: `Net: ${netBase} – ${DEFAULT_GRID_FREQUENCY_HZ} Hz`,
      }),
      variant: 'body',
    })
    if (earthing) {
      lines.push({
        text: t('panels.diagramEarthingSystem', {
          earthing: formatEarthingLabel(earthing, t),
          defaultValue: `Earthing system: ${earthing}`,
        }),
        variant: 'body',
      })
    }
  }

  return lines
}

export function getPanelSymbolLabel(
  project: PanelDiagramProject,
  panel: Panel,
  advancedLabelsEnabled: boolean
): string {
  const displayName = getPanelDisplayName(panel, project)
  const installation = getElectricalInstallationFromProject(project)
  if (!installation || !isPanelNumberingActive(installation, advancedLabelsEnabled)) {
    return displayName
  }
  const index = buildPanelNumberIndexById(getElectricalPanelsFromProject(project)).get(panel.id)
  if (index == null) return displayName
  return `${formatPanelCode(index)}  ${displayName}`
}

export function getPanelDiagramTitleLine(
  project: PanelDiagramProject,
  panel: Panel,
  t: TFunction,
  advancedLabelsEnabled: boolean
): string {
  const lines = buildPanelDiagramHeaderLines(project, panel, t, { advancedLabelsEnabled })
  return lines[0]?.text ?? getPanelDisplayName(panel, project)
}
