import type { Point2 } from '@/types/schema'

type InvertibleTransform = {
  copy: () => {
    invert: () => {
      point: (point: Point2) => Point2
    }
  }
}

type TransformNode = {
  getAbsoluteTransform: () => InvertibleTransform
}

type ScaleRulerStage = {
  children?: TransformNode[]
  findOne: (selector: string) => TransformNode | null | undefined
  getPointerPosition: () => Point2 | null
}

/** Convert the current stage pointer into the plan content group's world coordinates. */
export function scaleRulerPointerToCanvas(stage: ScaleRulerStage): Point2 | null {
  const pointer = stage.getPointerPosition()
  if (!pointer) return null

  // Pan and zoom are applied to this group, not to its containing Konva layer.
  const contentNode = stage.findOne('.canvas-content') ?? stage.children?.[0]
  if (!contentNode) return null

  return contentNode.getAbsoluteTransform().copy().invert().point(pointer)
}
