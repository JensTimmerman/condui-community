import { usePlanDragVisualStore } from '@/stores/planDragVisualStore'
import type { Point } from '@/types/ui'
import type { SituationPlanRotation } from '@/types/schema'

type LabelPoint = { x: number; y: number }

type PendingDragVisual = {
  positions: Map<string, Point> | null
  labels: Map<string, LabelPoint> | null
  rotations: Map<string, SituationPlanRotation> | null
  clear: boolean
}

const pending: PendingDragVisual = {
  positions: null,
  labels: null,
  rotations: null,
  clear: false,
}

let dragVisualRafId: number | null = null

function mergeInto(target: Map<string, Point> | null, source: Map<string, Point>): Map<string, Point> {
  const next = new Map(target ?? undefined)
  source.forEach((value, key) => next.set(key, value))
  return next
}

function mergeLabels(
  target: Map<string, LabelPoint> | null,
  source: Map<string, LabelPoint>,
): Map<string, LabelPoint> {
  const next = new Map(target ?? undefined)
  source.forEach((value, key) => next.set(key, value))
  return next
}

function mergeRotations(
  target: Map<string, SituationPlanRotation> | null,
  source: Map<string, SituationPlanRotation>,
): Map<string, SituationPlanRotation> {
  const next = new Map(target ?? undefined)
  source.forEach((value, key) => next.set(key, value))
  return next
}

function flushPlanDragVisual() {
  dragVisualRafId = null
  const { patch, clear } = usePlanDragVisualStore.getState()

  if (pending.clear) {
    pending.clear = false
    pending.positions = null
    pending.labels = null
    pending.rotations = null
    clear()
    return
  }

  const update: {
    positions?: Map<string, Point>
    labels?: Map<string, LabelPoint>
    rotations?: Map<string, SituationPlanRotation>
  } = {}
  const store = usePlanDragVisualStore.getState()

  if (pending.positions) {
    update.positions = mergeInto(store.positions, pending.positions)
    pending.positions = null
  }
  if (pending.labels) {
    update.labels = mergeLabels(store.labels, pending.labels)
    pending.labels = null
  }
  if (pending.rotations) {
    update.rotations = mergeRotations(store.rotations, pending.rotations)
    pending.rotations = null
  }

  if (update.positions || update.labels || update.rotations) {
    patch(update)
  }
}

export function schedulePlanDragVisualFlush(partial: {
  positions?: Map<string, Point>
  labels?: Map<string, LabelPoint>
  rotations?: Map<string, SituationPlanRotation>
  clear?: boolean
}) {
  if (partial.clear) pending.clear = true
  if (partial.positions) pending.positions = mergeInto(pending.positions, partial.positions)
  if (partial.labels) pending.labels = mergeLabels(pending.labels, partial.labels)
  if (partial.rotations) pending.rotations = mergeRotations(pending.rotations, partial.rotations)

  if (dragVisualRafId != null) return
  dragVisualRafId = requestAnimationFrame(flushPlanDragVisual)
}

export function resetPlanDragVisualFlush() {
  if (dragVisualRafId != null) {
    cancelAnimationFrame(dragVisualRafId)
    dragVisualRafId = null
  }
  pending.positions = null
  pending.labels = null
  pending.rotations = null
  pending.clear = false
}
