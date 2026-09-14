/**
 * Eendraad slicing with clean cuts and fixed scale
 *
 * - Block bounds come directly from the layout engine's painted trunk envelopes.
 * - Cuts only at boundaries between envelopes (or between nested child envelopes when unavoidable).
 * - Secondary-bus blocks are split between child circuits only when wider than one slice.
 * - Adjacent pages render a small overlap and clip back to the safe core boundary so labels and
 *   secondary-bus notes are not cut at the page seam.
 */

import type { BottomUpPanelLayout, BottomUpCircuitLayout } from '@/lib/layout/bottomUpLayout'
import { LAYOUT_CONSTANTS, getPanelDiagramId } from '@/lib/layout/bottomUpLayout'
import type { ExportScene } from '../types'
import { A4_LANDSCAPE, getUsableArea } from '../pageSizes'
import { ExportError } from '../types'
import { exportLog } from '../exportLogger'
import { getPdfContentHeightMm } from '../pdfPageLayout'
import { getCircuitBusSectionId } from '@/lib/panel/panelBusSections'
import { getCircuitNotesPaintBounds } from '@/lib/layout/circuitNoteMetrics'

/** Overlap between adjacent slices in scene pixels is derived from this physical margin. */
const SLICE_OVERLAP_MM = 2

/** Estimated horizontal space for branch labels to the left of branchX (px). */
const LABEL_WIDTH_ESTIMATE_PX = 90

/**
 * Maximum scale (mm per scene pixel) for eendraad export. The height-based scale is capped
 * so the diagram does not appear larger than this; taller diagrams scale down to fit and
 * slicing adjusts (fewer, wider slices). Increase this to allow more zoom; decrease for smaller output.
 */
export const EENDRAAD_MAX_SCALE_MM_PER_PX = 0.25

/**
 * Export may shrink a one-wire document by at most this fraction when doing so
 * removes a sparse trailing page. Keeping this bounded protects label
 * readability while allowing near-fit diagrams to stay together.
 */
const MAX_PAGE_COMPACTION_REDUCTION = 0.15
const PAGE_COMPACTION_STEP = 0.005

export interface FrameSlice {
  x: number
  y: number
  width: number
  height: number
  circuitIds: string[]
  /** Overlap in scene px (each side); used to expand render bounds and clip to content. */
  overlapPx?: number
}

export interface EendraadSlicingResult {
  slices: FrameSlice[]
  globalScale: number
  mainBusY: number
}

/** One top-level painted trunk envelope and its nested circuit ownership. */
interface MainBusBlock {
  left: number
  right: number
  circuitIds: string[]
  busSectionId: string
  /** Child circuit extents used for safe internal cut points when the block is oversized. */
  nestedExtents?: Array<{ left: number; right: number }>
}

/**
 * Build safe page units from the same x/width rectangles drawn by the trunk debug overlay.
 * A top-level envelope owns every nested descendant. An inconsistent/legacy layout where a
 * descendant protrudes beyond its parent is conservatively unioned into the parent block.
 */
function getMainBusBlocks(panelLayout: BottomUpPanelLayout): MainBusBlock[] {
  const circuits = panelLayout.circuits
  const circuitNotes = panelLayout.circuitNotes
  const branches = panelLayout.branches
  const getCircuitVisualExtent = (cl: BottomUpCircuitLayout): { left: number; right: number } => {
    let left = cl.x
    let right = cl.x + cl.width

    // A circuit's nominal x/width covers its trunk envelope, but branch wires and their
    // labels can protrude beyond it. Keep those painted elements in the same page unit.
    for (const branch of branches) {
      if (branch.circuitId !== cl.circuit.id) continue
      right = Math.max(right, branch.branchX + branch.branchWidth)
      left = Math.min(
        left,
        branch.branchX - LAYOUT_CONSTANTS.LABEL_OFFSET - LABEL_WIDTH_ESTIMATE_PX
      )
    }

    for (const note of circuitNotes ?? []) {
      if (note.circuitId !== cl.circuit.id || note.notesVisible === false) continue
      const paintBounds = getCircuitNotesPaintBounds(note.label, note.notesOrientation)
      left = Math.min(left, note.x + paintBounds.left)
      right = Math.max(right, note.x + paintBounds.right)
    }

    return { left, right }
  }
  const blocks: MainBusBlock[] = []
  const childrenByParentId = new Map<string, BottomUpCircuitLayout[]>()
  for (const circuit of circuits) {
    const parentId = circuit.parentCircuit?.id
    if (!parentId) continue
    const children = childrenByParentId.get(parentId) ?? []
    children.push(circuit)
    childrenByParentId.set(parentId, children)
  }

  const collectDescendants = (root: BottomUpCircuitLayout): BottomUpCircuitLayout[] => {
    const descendants: BottomUpCircuitLayout[] = []
    const visit = (parentId: string) => {
      for (const child of childrenByParentId.get(parentId) ?? []) {
        descendants.push(child)
        visit(child.circuit.id)
      }
    }
    visit(root.circuit.id)
    return descendants
  }

  const topLevel = circuits.filter((cl) => cl.parentCircuit === null).sort((a, b) => a.x - b.x)

  for (const cl of topLevel) {
    const descendants = collectDescendants(cl)
    const ownedLayouts = [cl, ...descendants]
    const ownedExtents = ownedLayouts.map(getCircuitVisualExtent)
    const left = Math.min(...ownedExtents.map((extent) => extent.left))
    const right = Math.max(...ownedExtents.map((extent) => extent.right))
    const directChildren = childrenByParentId.get(cl.circuit.id) ?? []
    blocks.push({
      left,
      right,
      circuitIds: ownedLayouts.map((layout) => layout.circuit.id),
      busSectionId: getCircuitBusSectionId(
        panelLayout.panel,
        cl.circuit,
        cl.parentRcd ?? cl.protection ?? undefined
      ),
      nestedExtents: directChildren
        .map(getCircuitVisualExtent)
        .sort((a, b) => a.left - b.left),
    })
  }

  return blocks.sort((a, b) => a.left - b.left)
}

/**
 * Cut points: scene left, midpoints between consecutive blocks, and scene right.
 * For oversized RCD or parent/sub-circuit blocks, add internal cut points between child circuits.
 */
function getCutPoints(
  blocks: MainBusBlock[],
  sceneBounds: ExportScene['bounds'],
  sliceWidthPx: number
): number[] {
  const points: number[] = [sceneBounds.x]
  const sceneRight = sceneBounds.x + sceneBounds.width

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (i + 1 < blocks.length) {
      const next = blocks[i + 1]!
      points.push((block.right + next.left) / 2)
    } else {
      points.push(block.right)
    }
    if (block.nestedExtents && block.nestedExtents.length >= 2) {
      const blockWidth = block.right - block.left
      if (blockWidth > sliceWidthPx) {
        for (let j = 0; j < block.nestedExtents.length - 1; j++) {
          const a = block.nestedExtents[j]!
          const b = block.nestedExtents[j + 1]!
          points.push((a.right + b.left) / 2)
        }
      }
    }
  }
  points.push(sceneRight)
  return [...new Set(points)].sort((a, b) => a - b)
}

function isBusSectionBoundary(blocks: MainBusBlock[], cutPoint: number): boolean {
  for (let index = 0; index < blocks.length - 1; index++) {
    const left = blocks[index]!
    const right = blocks[index + 1]!
    if (left.busSectionId === right.busSectionId) continue
    const boundary = (left.right + right.left) / 2
    if (Math.abs(boundary - cutPoint) < 0.01) return true
  }
  return false
}

function getPanelInfoBlockNativeWidth(panelLayout: BottomUpPanelLayout): number | undefined {
  return panelLayout.layoutBlocks?.find((block) => block.kind === 'info-block')?.width
}

function computeGlobalScale(
  sceneBounds: ExportScene['bounds'],
  panelLayout: BottomUpPanelLayout
): number {
  return (
    getPdfContentHeightMm('landscape', {
      hasInfoBlock: true,
      hasPanelTitle: true,
      infoBlockNativeWidth: getPanelInfoBlockNativeWidth(panelLayout),
    }) / sceneBounds.height
  )
}

interface CoreSlice {
  left: number
  right: number
}

function getSliceWidthPxForScale(scale: number): number {
  const usable = getUsableArea(A4_LANDSCAPE)
  return usable.width / scale
}

function getSliceOverlapPx(globalScale: number): number {
  return SLICE_OVERLAP_MM / globalScale
}

function getBlocksInRange(blocks: MainBusBlock[], left: number, right: number): MainBusBlock[] {
  return blocks.filter((block) => block.left < right && block.right > left)
}

function buildCoreSlices(
  blocks: MainBusBlock[],
  sceneBounds: ExportScene['bounds'],
  globalScale: number
): CoreSlice[] {
  const sliceWidthPx = getSliceWidthPxForScale(globalScale)
  const cutPoints = getCutPoints(blocks, sceneBounds, sliceWidthPx)
  const sceneRight = sceneBounds.x + sceneBounds.width
  const slices: CoreSlice[] = []
  let startX = sceneBounds.x

  while (startX < sceneRight - 1) {
    const maxEndX = startX + sliceWidthPx
    const candidates = cutPoints.filter((cutPoint) => cutPoint > startX && cutPoint <= maxEndX)
    const furthestEndX = candidates.at(-1) ?? startX
    let bestEndX = furthestEndX

    // A physical bus-section transition is the cleanest place to break a drawing. Prefer
    // the latest such boundary that makes a useful page, but never isolate the first block
    // merely to preserve a section boundary. This keeps e.g. 1 grid + many backup circuits
    // packed naturally while making balanced grid/backup runs land on separate pages.
    const preferredBoundary = candidates
      .filter((cutPoint) => isBusSectionBoundary(blocks, cutPoint))
      .filter((cutPoint) => {
        const pageBlocks = getBlocksInRange(blocks, startX, cutPoint)
        const utilization = (cutPoint - startX) / sliceWidthPx
        return pageBlocks.length >= 2 && utilization >= 0.45
      })
      .at(-1)
    if (preferredBoundary != null) {
      const pagesAfterPreferred = Math.ceil((sceneRight - preferredBoundary) / sliceWidthPx)
      const pagesAfterFurthest = Math.ceil((sceneRight - furthestEndX) / sliceWidthPx)
      if (pagesAfterPreferred <= pagesAfterFurthest) bestEndX = preferredBoundary
    }
    if (bestEndX <= startX) {
      bestEndX = Math.min(startX + sliceWidthPx, sceneRight)
    }
    slices.push({ left: startX, right: bestEndX })
    startX = bestEndX
  }

  // Greedy packing can put every available block on the penultimate page and
  // leave one tiny block alone. Move the smallest possible safe block group to
  // the tail when both resulting pages still fit and contain at least two
  // independent main-bus blocks. This changes only page cuts, never layout.
  if (slices.length >= 2) {
    const previous = slices[slices.length - 2]!
    const tail = slices[slices.length - 1]!
    const previousBlocks = getBlocksInRange(blocks, previous.left, previous.right)
    const tailBlocks = getBlocksInRange(blocks, tail.left, tail.right)

    if (tailBlocks.length === 1 && previousBlocks.length >= 3) {
      const candidates = cutPoints
        .filter((cutPoint) => cutPoint > previous.left && cutPoint < previous.right)
        .sort((a, b) => b - a)
      for (const cutPoint of candidates) {
        const leftBlocks = getBlocksInRange(blocks, previous.left, cutPoint)
        const rightBlocks = getBlocksInRange(blocks, cutPoint, tail.right)
        if (
          cutPoint - previous.left <= sliceWidthPx &&
          tail.right - cutPoint <= sliceWidthPx &&
          leftBlocks.length >= 2 &&
          rightBlocks.length >= 2
        ) {
          previous.right = cutPoint
          tail.left = cutPoint
          break
        }
      }
    }
  }

  return slices
}

function getSlicingMetrics(
  panelLayout: BottomUpPanelLayout,
  scene: ExportScene,
  globalScale: number
): { pageCount: number; sparseTail: boolean } {
  const blocks = getMainBusBlocks(panelLayout)
  if (blocks.length === 0) return { pageCount: 1, sparseTail: false }
  const slices = buildCoreSlices(blocks, scene.bounds, globalScale)
  const tail = slices.at(-1)
  return {
    pageCount: slices.length,
    sparseTail:
      slices.length > 1 && !!tail && getBlocksInRange(blocks, tail.left, tail.right).length <= 2,
  }
}

/**
 * Pick one document-wide scale before rendering. A smaller scale is accepted
 * only when the existing plan has a sparse tail and the change removes at
 * least one PDF page. The largest successful scale wins.
 */
export function chooseEendraadDocumentScale(
  panelLayouts: BottomUpPanelLayout[],
  scenesByPanelId: Map<string, ExportScene>,
  initialScale: number
): number {
  const getDocumentMetrics = (scale: number) => {
    let pageCount = 0
    let sparseTailCount = 0
    for (const panelLayout of panelLayouts) {
      if (panelLayout.frameRole === 'supply') continue
      const scene = scenesByPanelId.get(getPanelDiagramId(panelLayout))
      if (!scene) continue
      const metrics = getSlicingMetrics(panelLayout, scene, scale)
      pageCount += metrics.pageCount
      if (metrics.sparseTail) sparseTailCount++
    }
    return { pageCount, sparseTailCount }
  }

  const baseline = getDocumentMetrics(initialScale)
  if (baseline.sparseTailCount === 0) return initialScale

  const steps = Math.round(MAX_PAGE_COMPACTION_REDUCTION / PAGE_COMPACTION_STEP)
  for (let step = 1; step <= steps; step++) {
    const candidateScale = initialScale * (1 - step * PAGE_COMPACTION_STEP)
    const candidate = getDocumentMetrics(candidateScale)
    if (
      candidate.pageCount < baseline.pageCount &&
      candidate.sparseTailCount < baseline.sparseTailCount
    ) {
      return candidateScale
    }
  }

  return initialScale
}

/**
 * Fast dialog estimate using layout-frame bounds only. It intentionally avoids
 * cloning Konva scenes or loading SVG/image assets; the actual export remains
 * authoritative for unusual visual extents.
 */
export function estimateEendraadPageCount(panelLayouts: BottomUpPanelLayout[]): number {
  const scenesByPanelId = new Map<string, ExportScene>()
  for (const panelLayout of panelLayouts) {
    scenesByPanelId.set(getPanelDiagramId(panelLayout), {
      bounds: {
        x: panelLayout.frame.x,
        y: panelLayout.frame.y,
        width: panelLayout.frame.width,
        height: panelLayout.frame.height,
        space: 'scene',
      },
    } as ExportScene)
  }

  const scale = chooseEendraadDocumentScale(
    panelLayouts,
    scenesByPanelId,
    EENDRAAD_MAX_SCALE_MM_PER_PX
  )
  return panelLayouts.reduce((count, panelLayout) => {
    if (panelLayout.frameRole === 'supply') return count + 1
    const scene = scenesByPanelId.get(getPanelDiagramId(panelLayout))
    return scene ? count + getSlicingMetrics(panelLayout, scene, scale).pageCount : count
  }, 0)
}

export async function calculateEendraadSlices(
  panelLayout: BottomUpPanelLayout,
  scene: ExportScene,
  documentGlobalScale?: number
): Promise<EendraadSlicingResult> {
  const sceneBounds = scene.bounds
  if (panelLayout.frameRole === 'supply') {
    const contentWidth = getUsableArea(A4_LANDSCAPE).width
    const contentHeight = getPdfContentHeightMm('landscape', {
      hasInfoBlock: true,
      hasPanelTitle: true,
      infoBlockNativeWidth: getPanelInfoBlockNativeWidth(panelLayout),
    })
    const globalScale = Math.min(
      EENDRAAD_MAX_SCALE_MM_PER_PX,
      contentWidth / sceneBounds.width,
      contentHeight / sceneBounds.height
    )
    return {
      slices: [
        {
          x: sceneBounds.x,
          y: sceneBounds.y,
          width: sceneBounds.width,
          height: sceneBounds.height,
          circuitIds: [],
        },
      ],
      globalScale,
      mainBusY: panelLayout.mainBus.y,
    }
  }
  const blocks = getMainBusBlocks(panelLayout)
  const rawScale = documentGlobalScale ?? computeGlobalScale(sceneBounds, panelLayout)
  const globalScale = Math.min(rawScale, EENDRAAD_MAX_SCALE_MM_PER_PX)
  const mainBusY = panelLayout.mainBus.y
  const sliceWidthPx = getSliceWidthPxForScale(globalScale)
  const overlapPx = getSliceOverlapPx(globalScale)

  if (rawScale > EENDRAAD_MAX_SCALE_MM_PER_PX) {
    exportLog(
      `[Export] Eendraad scale capped: raw=${rawScale.toFixed(6)} -> ${globalScale.toFixed(6)} mm/px (max=${EENDRAAD_MAX_SCALE_MM_PER_PX})`
    )
  }
  exportLog(
    `[Export] Eendraad slice scale: globalScale=${globalScale.toFixed(6)} mm/px, ` +
      `sliceWidthPx=${sliceWidthPx.toFixed(0)}, sceneHeight=${sceneBounds.height.toFixed(0)}, ` +
      `source=${documentGlobalScale != null ? 'document' : 'panel'}`
  )

  if (blocks.length === 0) {
    return {
      slices: [
        {
          x: sceneBounds.x,
          y: sceneBounds.y,
          width: sceneBounds.width,
          height: sceneBounds.height,
          circuitIds: [],
        },
      ],
      globalScale,
      mainBusY,
    }
  }

  const coreSlices = buildCoreSlices(blocks, sceneBounds, globalScale)
  const slices: FrameSlice[] = []
  const allCircuitIds = new Set(blocks.flatMap((b) => b.circuitIds))

  for (const coreSlice of coreSlices) {
    const circuitIds = blocks
      .filter((b) => b.left < coreSlice.right && b.right > coreSlice.left)
      .flatMap((b) => b.circuitIds)

    slices.push({
      x: coreSlice.left,
      y: sceneBounds.y,
      width: coreSlice.right - coreSlice.left,
      height: sceneBounds.height,
      circuitIds,
      overlapPx,
    })
  }

  validateSlices(
    slices,
    Array.from(allCircuitIds).map((id) => {
      const b = blocks.find((bl) => bl.circuitIds.includes(id))!
      return { id, x: b.left, right: b.right }
    })
  )
  exportLog(
    `[Export] Eendraad slice result: scale=${globalScale.toFixed(6)} mm/px (use as reference for minimum scale), slices=${slices.length}`
  )
  return { slices, globalScale, mainBusY }
}

export function validateSlices(
  slices: FrameSlice[],
  circuits: Array<{ id: string; x: number; right: number }>
): void {
  const allCircuitIds = new Set(circuits.map((c) => c.id))
  const slicedCircuitIds = new Set(slices.flatMap((s) => s.circuitIds))
  const missing = Array.from(allCircuitIds).filter((id) => !slicedCircuitIds.has(id))
  if (missing.length > 0) {
    throw new ExportError(
      'SLICE_VALIDATION_FAILED',
      `Missing circuits in slices: ${missing.join(', ')}`
    )
  }
  if (circuits.length > 0) {
    const emptySlices = slices.filter((s) => s.circuitIds.length === 0)
    if (emptySlices.length > 0) {
      throw new ExportError(
        'SLICE_VALIDATION_FAILED',
        `Empty slices detected: ${emptySlices.length}`
      )
    }
  }
}
