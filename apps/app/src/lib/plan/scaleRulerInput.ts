/** Only the primary mouse button may place or replace plan-scale ruler points. */
export function isScaleRulerPlacementButton(button: number | null | undefined): boolean {
  return button === 0
}
