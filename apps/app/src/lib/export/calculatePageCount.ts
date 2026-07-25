/**
 * Calculate page counts for PDF export
 */

import type { Panel } from '@/types/schema'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { A4_LANDSCAPE, getUsableArea } from './pageSizes'
import { buildSitplanExportTargets } from './sitplanExportPlan'
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
 * Calculate how many slices a frame needs based on its width
 * This is a simplified version - the actual slicing will be done during export
 */
function calculateFrameSlices(frameWidth: number, frameHeight: number): number {
  const usableArea = getUsableArea(A4_LANDSCAPE)
  const usableWidthMm = usableArea.width
  const usableHeightMm = usableArea.height
  
  // Convert pixels to mm (assuming 96 DPI = 3.779527559 pixels per mm)
  // Actually, we need to know the scale. For now, assume 1px = 0.264583mm (96 DPI)
  const PIXELS_PER_MM = 3.779527559
  const frameWidthMm = frameWidth / PIXELS_PER_MM
  const frameHeightMm = frameHeight / PIXELS_PER_MM
  
  // If it fits on one page, return 1
  if (frameWidthMm <= usableWidthMm && frameHeightMm <= usableHeightMm) {
    return 1
  }
  
  // Calculate how many horizontal slices we need
  const horizontalSlices = Math.ceil(frameWidthMm / usableWidthMm)
  
  // For now, assume we only slice horizontally (vertical slicing would be more complex)
  // In practice, we'll slice at circuit boundaries, so this is an approximation
  return horizontalSlices
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
 * @param getFramesByPanel Function to get frames by panel ID (optional, for when layout is provided)
 */
export function calculatePageCounts(
  options: PageCountOptions,
  project: PageCountProject,
  layout?: BottomUpLayoutResult | null,
  getFramesByPanel?: (panelId: string) => import('@/types/schema').Frame[]
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
    if (layout && getFramesByPanel) {
      // Count frames and estimate slices
      for (const panelLayout of layout.panels) {
        const frames = getFramesByPanel(panelLayout.panel.id)
        
        if (frames.length === 0) {
          // No frames - the panel itself is one "frame" for export purposes
          // Use the panel layout frame dimensions
          const slices = calculateFrameSlices(
            panelLayout.frame.width,
            panelLayout.frame.height
          )
          eendraad += slices
        } else {
          // Count slices for each frame
          for (const _frame of frames) {
            // Calculate frame bounds (this is approximate - actual bounds calculated in FrameComponent)
            // For now, use a rough estimate based on panel layout
            // The actual export will calculate proper bounds
            const estimatedWidth = panelLayout.frame.width
            const estimatedHeight = panelLayout.frame.height
            const slices = calculateFrameSlices(estimatedWidth, estimatedHeight)
            eendraad += slices
          }
        }
      }
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
