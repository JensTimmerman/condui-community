import type Konva from 'konva'

/** Keep a lightweight transformed overlay on the exact live camera of its content layer. */
export function mirrorLayerCameraTransform(
  source: Konva.Layer,
  target: Konva.Layer | null | undefined,
): void {
  if (!target) return
  target.position(source.position())
  target.scale(source.scale())
}
