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

  const cutPoints = getCutPoints(blocks, sceneBounds, sliceWidthPx)
  const slices: FrameSlice[] = []
  let startX = sceneBounds.x
  const sceneRight = sceneBounds.x + sceneBounds.width
  const allCircuitIds = new Set(blocks.flatMap((b) => b.circuitIds))

  while (startX < sceneRight - 1) {
    const maxEndX = startX + sliceWidthPx
    let bestEndX = startX
    for (const cp of cutPoints) {
      if (cp > startX && cp <= maxEndX) bestEndX = cp
    }
    if (bestEndX <= startX) {
      bestEndX = Math.min(startX + sliceWidthPx, sceneRight)
    }

    const circuitIds = blocks
      .filter((b) => b.left < bestEndX && b.right > startX)
      .flatMap((b) => b.circuitIds)

    const sliceContentLeft = startX
    const sliceContentRight = bestEndX
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
    startX = bestEndX
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
