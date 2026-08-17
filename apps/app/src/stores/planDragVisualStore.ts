import { create } from 'zustand'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { Point } from '@/types/ui'
import type { SituationPlanRotation } from '@/types/schema'

type LabelPoint = { x: number; y: number }

type PlanDragVisualState = {
  positions: Map<string, Point>
  labels: Map<string, LabelPoint>
  rotations: Map<string, SituationPlanRotation>
  patch: (update: {
    positions?: Map<string, Point>
    labels?: Map<string, LabelPoint>
    rotations?: Map<string, SituationPlanRotation>
  }) => void
  clear: () => void
}

const emptyPositions = () => new Map<string, Point>()
const emptyLabels = () => new Map<string, LabelPoint>()
const emptyRotations = () => new Map<string, SituationPlanRotation>()

export const usePlanDragVisualStore = create<PlanDragVisualState>((set) => ({
  positions: emptyPositions(),
  labels: emptyLabels(),
  rotations: emptyRotations(),
  patch: (update) =>
    set((state) => ({
      positions: update.positions ?? state.positions,
      labels: update.labels ?? state.labels,
      rotations: update.rotations ?? state.rotations,
    })),
  clear: () =>
    set({
      positions: emptyPositions(),
      labels: emptyLabels(),
      rotations: emptyRotations(),
    }),
}))

const pointEqual = (a: Point | null, b: Point | null) =>
  a === b || (a != null && b != null && a.x === b.x && a.y === b.y)

const labelEqual = (a: LabelPoint | null, b: LabelPoint | null) =>
  a === b || (a != null && b != null && a.x === b.x && a.y === b.y)

const rotationEqual = (a: SituationPlanRotation | null | undefined, b: SituationPlanRotation | null | undefined) => a === b

/** Per-placement drag position — only re-renders when this symbol moves. */
export function usePlanDragPosition(placementId: string): Point | null {
  return useStoreWithEqualityFn(
    usePlanDragVisualStore,
    (s) => s.positions.get(placementId) ?? null,
    pointEqual,
  )
}

export function usePlanDragLabel(placementId: string): LabelPoint | null {
  return useStoreWithEqualityFn(
    usePlanDragVisualStore,
    (s) => s.labels.get(placementId) ?? null,
    labelEqual,
  )
}

export function usePlanDragRotation(placementId: string): SituationPlanRotation | null {
  return useStoreWithEqualityFn(
    usePlanDragVisualStore,
    (s) => s.rotations.get(placementId) ?? null,
    rotationEqual,
  )
}

/** Whole map for layers that must follow all dragged symbols (wires, debug). */
export function usePlanDragPositionsMap(): Map<string, Point> {
  return usePlanDragVisualStore((s) => s.positions)
}

export function setPlanDragPreviewPositions(positions: Map<string, Point>) {
  usePlanDragVisualStore.getState().patch({ positions })
}
