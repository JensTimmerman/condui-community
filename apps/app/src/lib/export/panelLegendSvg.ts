import { A4_PORTRAIT, PAGE_MARGIN } from './pageSizes'
import type { Panel, Circuit, ProtectionDevice, CircuitKind } from '@/types/schema'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

interface CircuitLegendRow {
  panelName: string
  circuitCode: string
  kind: CircuitKind
  protection: ProtectionDevice | null
  notes: string | undefined
}

function collectAllPanelsWithPath(panels: Panel[], prefix: string[] = []): Array<{ panel: Panel; pathLabel: string }> {
  const result: Array<{ panel: Panel; pathLabel: string }> = []
  for (const panel of panels) {
    const path = [...prefix, panel.name]
    result.push({ panel, pathLabel: path.join(' / ') })
    result.push(...collectAllPanelsWithPath(panel.subPanels, path))
  }
  return result
}

function getProtectionForCircuit(panel: Panel, circuitId: string): ProtectionDevice | null {
  for (const protection of panel.protections) {
    if (protection.circuits?.some((c) => c.id === circuitId)) {
      return protection
    }
  }
  return null
}

export function buildPanelCircuitLegendRows(project: ProjectWithOptionalV2Electrical): CircuitLegendRow[] {
  const rows: CircuitLegendRow[] = []
  const panelsWithPath = collectAllPanelsWithPath(getElectricalPanelsFromProject(project))

  for (const { panel, pathLabel } of panelsWithPath) {
    const addCircuit = (circuit: Circuit) => {
      if (!circuit.code) return
      // Skip synthetic / empty feeder circuits (e.g. panel-labelled, no loads, or derived empty)
      const hasLoads = circuit.endpoints.length > 0 || (circuit.trunkDevices?.length ?? 0) > 0
      if (!hasLoads) return
      const protection = getProtectionForCircuit(panel, circuit.id)
      const kind = getDerivedCircuitKind(circuit, protection ?? undefined)
      if (kind === 'empty') return
      const codeLower = circuit.code.toLowerCase()
      const nameLower = panel.name.toLowerCase()
      if (codeLower === 'panel' || codeLower === nameLower) return
      rows.push({
        panelName: pathLabel,
        circuitCode: circuit.code,
        kind,
        protection,
        notes: circuit.notes,
      })
    }

    for (const circuit of panel.circuits) {
      addCircuit(circuit)
    }

    for (const protection of panel.protections) {
      if (!protection.circuits) continue
      for (const circuit of protection.circuits) {
        addCircuit(circuit)
      }
    }
  }

  rows.sort((a, b) => {
    if (a.panelName === b.panelName) {
      return a.circuitCode.localeCompare(b.circuitCode, undefined, { numeric: true })
    }
    return a.panelName.localeCompare(b.panelName)
  })

  return rows
}

function formatProtection(protection: ProtectionDevice | null): string {
  if (!protection) return ''
  const parts: string[] = []
  if (protection.ratingA != null) {
    parts.push(`${protection.ratingA}A`)
  }
  if (protection.curve) {
    parts.push(`curve ${protection.curve}`)
  }
  if (protection.polesConfig) {
    parts.push(protection.polesConfig)
  }
  if (protection.sensitivityMa != null) {
    parts.push(`${protection.sensitivityMa}mA`)
  }
  if (protection.residualCurrentType) {
    parts.push(protection.residualCurrentType)
  }
  return parts.join(' ')
}

export interface PanelLegendLabels {
  title: string
  panel: string
  circuit: string
  type: string
  protection: string
  notes: string
  kindLabels: Record<CircuitKind, string>
}

export function buildPanelLegendSvg(
  rows: CircuitLegendRow[],
  fontFamily: string,
  labels: PanelLegendLabels,
): string {
  const width = A4_PORTRAIT.width
  const height = A4_PORTRAIT.height
  const startX = PAGE_MARGIN
  const startY = PAGE_MARGIN
  const lineHeight = 4

  const colCircuit = startX
  const colType = startX + 30
  const colProtection = startX + 70
  const colNotes = startX + 120

  let y = startY

  const lines: string[] = []
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  )

  lines.push(
    `<text x="${startX}" y="${y}" font-size="6" font-family="${fontFamily}" font-weight="bold">` +
      escapeXml(labels.title) +
      `</text>`,
  )
  y += lineHeight * 1.8

  lines.push(
    `<text x="${colCircuit}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.circuit,
    )}</text>`,
  )
  lines.push(
    `<text x="${colType}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.type,
    )}</text>`,
  )
  lines.push(
    `<text x="${colProtection}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.protection,
    )}</text>`,
  )
  lines.push(
    `<text x="${colNotes}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.notes,
    )}</text>`,
  )

  y += lineHeight

  let currentPanel: string | null = null

  for (const row of rows) {
    if (y > height - PAGE_MARGIN) {
      break
    }

    if (row.panelName !== currentPanel) {
      currentPanel = row.panelName
      y += lineHeight * 0.5
      lines.push(
        `<text x="${startX}" y="${y}" font-size="3.4" font-family="${fontFamily}" font-weight="bold">${escapeXml(
          `${labels.panel}: ${currentPanel}`,
        )}</text>`,
      )
      y += lineHeight
      if (y > height - PAGE_MARGIN) {
        break
      }
    }

    const circuitText = row.circuitCode
    const typeText = labels.kindLabels[row.kind]
    const protText = formatProtection(row.protection)
    const notesText = row.notes ?? ''

    lines.push(
      `<text x="${colCircuit}" y="${y}" font-size="3" font-family="${fontFamily}">${escapeXml(
        circuitText,
      )}</text>`,
    )
    lines.push(
      `<text x="${colType}" y="${y}" font-size="3" font-family="${fontFamily}">${escapeXml(
        typeText,
      )}</text>`,
    )
    if (protText) {
      lines.push(
        `<text x="${colProtection}" y="${y}" font-size="3" font-family="${fontFamily}">${escapeXml(
          protText,
        )}</text>`,
      )
    }
    if (notesText) {
      lines.push(
        `<text x="${colNotes}" y="${y}" font-size="3" font-family="${fontFamily}">${escapeXml(
          notesText,
        )}</text>`,
      )
    }

    y += lineHeight
  }

  lines.push('</svg>')

  return lines.join('')
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

