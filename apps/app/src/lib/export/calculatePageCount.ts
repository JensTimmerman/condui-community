/**
 * Calculate page counts for PDF export
 */

import type { Panel } from '@/types/schema'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { buildSitplanExportTargets } from './sitplanExportPlan'
import { estimateEendraadPageCount } from './slicing/eendraadSlicing'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

type PageCountProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building

export interface PageCountSummary {
  eendraad: number
  panel: number
  sitplan: number
  total: number
}

// ExportOptions is now defined in types.ts, but for page counting we only need these fields
export interface PageCountOptions {
  includeEendraad: boolean
  includePanel: boolean
  includeSitplan: boolean
}

/**
 * Count all panels recursively (including sub-panels)
 */
function countAllPanels(panels: Panel[]): number {
  return panels.reduce((count, p) => {
    return count + 1 + countAllPanels(p.subPanels)
  }, 0)
}

function countMainPanels(panels: Panel[]): number {
  return panels.reduce((count, panel) => {
    return count + (panel.isMain ? 1 : 0) + countMainPanels(panel.subPanels)
  }, 0)
}

/**
 * Calculate page counts for export
 *
 * @param options Export options
 * @param project Current project
 * @param layout Eendraad layout (optional)
 */
export function calculatePageCounts(
  options: PageCountOptions,
  project: PageCountProject,
  layout?: BottomUpLayoutResult | null,
  _getFramesByPanel?: (panelId: string) => import('@/types/schema').Frame[]
): PageCountSummary {
  // If project not provided, try to get from store (but this won't work in non-React context)
  // So we require it as a parameter
  if (!project) {
    return { eendraad: 0, panel: 0, sitplan: 0, total: 0 }
  }

  let eendraad = 0
  let panel = 0
  let sitplan = 0

  // Calculate sitplan pages (1 per floor)
  if (options.includeSitplan) {
    sitplan = buildSitplanExportTargets(project).length
  }

  // Calculate panel pages (1 per panel)
  if (options.includePanel) {
    const projectPanels = getElectricalPanelsFromProject(project)
    const panelCount = countAllPanels(projectPanels)
    const mainPanelCount = countMainPanels(projectPanels)
    panel = panelCount
    if (panelCount > 3) {
      panel += 1
    }
    if (mainPanelCount > 1) {
      panel += 1
    }
    if (panelCount > 0) {
      panel += 1
    }
  }

  // Calculate 1draad pages (sliced frames)
  if (options.includeEendraad) {
    if (layout) {
      eendraad = estimateEendraadPageCount(layout.panels)
    } else {
      // No layout available - estimate based on number of panels
      const panelCount = countAllPanels(getElectricalPanelsFromProject(project))
      // Rough estimate: assume 1 page per panel (will be more accurate during actual export)
      eendraad = panelCount
    }
  }

  const total = eendraad + panel + sitplan

  return { eendraad, panel, sitplan, total }
}
