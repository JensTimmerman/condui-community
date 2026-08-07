/**
 * Eendraad slicing with clean cuts and fixed scale
 *
 * - Block bounds use full visual extent: trunk, branches, labels, and secondary bus.
 * - Cuts only at midpoints between blocks (or inside long RCD groups when unavoidable).
 * - Secondary-bus blocks are split between child circuits only when wider than one slice.
 * - Optional overlap between adjacent slices with clipping for continuous appearance.
 */

import type { BottomUpPanelLayout, BottomUpCircuitLayout } from '@/lib/layout/bottomUpLayout'
import { LAYOUT_CONSTANTS, estimateCircuitNotesWidth } from '@/lib/layout/bottomUpLayout'
import type { ExportScene } from '../types'
import { A4_LANDSCAPE, getUsableArea } from '../pageSizes'
import { ExportError } from '../types'
import { exportLog } from '../exportLogger'
import { getPdfContentHeightMm } from '../pdfPageLayout'

/** Estimated horizontal space for branch labels to the left of branchX (px). */
const LABEL_WIDTH_ESTIMATE_PX = 90

/** Overlap between adjacent slices in mm (Section 4: avoid cutting through lines/text). */
const SLICE_OVERLAP_MM = 2

/** Extra horizontal margin around each slice to avoid clipping labels near the edge (mm). */
const SLICE_LABEL_MARGIN_MM = 2

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

/** One main-bus block with full visual extent; may represent top-level circuit(s) or one RCD group. */
interface MainBusBlock {
  left: number
  right: number
  circuitIds: string[]
  /** Child circuit extents used for safe internal cut points when the block is oversized. */
  nestedExtents?: Array<{ left: number; right: number }>
}

/**
 * Compute visual extent of a circuit (incl. branches and label margin) in scene coords.
 * Uses layout x/width and branches so we never cut through endpoint branches or labels.
 */
function getCircuitVisualExtent(
  cl: BottomUpCircuitLayout,
  branches: Array<{ circuitId: string; branchX: number; branchWidth: number }>,
  circuitNotes: BottomUpPanelLayout['circuitNotes'] | undefined
): { left: number; right: number } {
  const circuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)
  let left = cl.x
  let right = cl.x + cl.width
  for (const b of circuitBranches) {
    right = Math.max(right, b.branchX + b.branchWidth)
    left = Math.min(left, b.branchX - LAYOUT_CONSTANTS.LABEL_OFFSET - LABEL_WIDTH_ESTIMATE_PX)
  }

  // Expand extents to include vertical circuit notes rendered above the diagram.
  if (circuitNotes && circuitNotes.length > 0) {
    for (const note of circuitNotes) {
      if (note.circuitId !== cl.circuit.id) continue
      if (note.notesOrientation !== 'vertical') continue
      if (note.notesVisible === false) continue
      const estWidth = estimateCircuitNotesWidth(note.label)
      const half = estWidth / 2
      left = Math.min(left, note.x - half)
      right = Math.max(right, note.x + half)
    }
  }
  return { left, right }
}

/**
 * Build main-bus blocks with full visual extent (branches, labels, secondary bus).
 * (1) Top-level circuits: one block per circuit, extent includes all nested circuits' visual extents.
 * (2) RCD groups: one block per RCD; extent is union of all circuits under that RCD; never split unless very long.
 */
function getMainBusBlocks(panelLayout: BottomUpPanelLayout): MainBusBlock[] {
  const circuits = panelLayout.circuits
  const branches = panelLayout.branches.map((b) => ({
    circuitId: b.circuitId,
    branchX: b.branchX,
    branchWidth: b.branchWidth,
  }))

  const blocks: MainBusBlock[] = []
  const circuitNotes = panelLayout.circuitNotes

  const topLevel = circuits
    .filter((cl) => cl.parentRcd === null && cl.parentCircuit === null)
    .sort((a, b) => a.x - b.x)

  for (const cl of topLevel) {
    const ext = getCircuitVisualExtent(cl, branches, circuitNotes)
    let left = ext.left
    let right = ext.right
    const ids = [cl.circuit.id]
    const nestedExtents: Array<{ left: number; right: number }> = []
    for (const other of circuits) {
      if (other.parentCircuit?.id === cl.circuit.id) {
        ids.push(other.circuit.id)
        const nestedExt = getCircuitVisualExtent(other, branches, circuitNotes)
        nestedExtents.push(nestedExt)
        left = Math.min(left, nestedExt.left)
        right = Math.max(right, nestedExt.right)
      }
    }
    blocks.push({
      left,
      right,
      circuitIds: ids,
      nestedExtents: nestedExtents.sort((a, b) => a.left - b.left),
    })
  }

  const rcdIds = new Set(circuits.map((c) => c.parentRcd?.id).filter(Boolean) as string[])
  for (const rcdId of rcdIds) {
    const underRcd = circuits.filter((c) => c.parentRcd?.id === rcdId)
    if (underRcd.length === 0) continue
    const extents = underRcd.map((c) => getCircuitVisualExtent(c, branches, circuitNotes))
    const left = Math.min(...extents.map((e) => e.left))
    const right = Math.max(...extents.map((e) => e.right))
    const nestedExtents = extents
      .map((e) => ({ left: e.left, right: e.right }))
      .sort((a, b) => a.left - b.left)
    blocks.push({
      left,
      right,
      circuitIds: underRcd.map((c) => c.circuit.id),
      nestedExtents,
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

function computeGlobalScale(sceneBounds: ExportScene['bounds']): number {
  return (
    getPdfContentHeightMm('landscape', { hasInfoBlock: true, hasPanelTitle: true }) /
    sceneBounds.height
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

/**
 * Overlap in scene pixels so adjacent slices overlap by SLICE_OVERLAP_MM each side.
 * scale = mm per scene pixel => 1 px = scale mm => overlapPx = SLICE_OVERLAP_MM / scale.
 */
function getOverlapPx(globalScale: number): number {
  return SLICE_OVERLAP_MM / globalScale
}

function getLabelMarginPx(globalScale: number): number {
  return SLICE_LABEL_MARGIN_MM / globalScale
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
    let bestEndX = startX
    for (const cutPoint of cutPoints) {
      if (cutPoint > startX && cutPoint <= maxEndX) bestEndX = cutPoint
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
      const scene = scenesByPanelId.get(panelLayout.panel.id)
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
    scenesByPanelId.set(panelLayout.panel.id, {
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
    const scene = scenesByPanelId.get(panelLayout.panel.id)
    return scene ? count + getSlicingMetrics(panelLayout, scene, scale).pageCount : count
  }, 0)
}

export async function calculateEendraadSlices(
  panelLayout: BottomUpPanelLayout,
  scene: ExportScene,
  documentGlobalScale?: number
): Promise<EendraadSlicingResult> {
  const sceneBounds = scene.bounds
  const blocks = getMainBusBlocks(panelLayout)
  const rawScale = documentGlobalScale ?? computeGlobalScale(sceneBounds)
  const globalScale = Math.min(rawScale, EENDRAAD_MAX_SCALE_MM_PER_PX)
  const mainBusY = panelLayout.mainBus.y
  const sliceWidthPx = getSliceWidthPxForScale(globalScale)
  const overlapPx = getOverlapPx(globalScale)
  const labelMarginPx = getLabelMarginPx(globalScale)

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
  const sceneRight = sceneBounds.x + sceneBounds.width
  const allCircuitIds = new Set(blocks.flatMap((b) => b.circuitIds))

  for (const coreSlice of coreSlices) {
    const circuitIds = blocks
      .filter((b) => b.left < coreSlice.right && b.right > coreSlice.left)
      .flatMap((b) => b.circuitIds)

    const sliceContentLeft = coreSlice.left
    const sliceContentRight = coreSlice.right
    const sliceLeft = Math.max(sceneBounds.x, sliceContentLeft - labelMarginPx)
    const sliceRight = Math.min(sceneRight, sliceContentRight + labelMarginPx)

    slices.push({
      x: sliceLeft,
      y: sceneBounds.y,
      width: sliceRight - sliceLeft,
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
