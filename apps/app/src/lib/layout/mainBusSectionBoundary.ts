/** Geometry of a secondary bus that belongs to one explicit main-bus section. */
export interface SecondaryBusSectionRange {
  sectionId: string
  startX: number
  endX: number
}

/**
 * Return the visible cut between two adjacent section-owned secondary buses.
 *
 * Main-bus segments are normally split at the midpoint between neighboring
 * protection symbols. Once a grouped/secondary bus exists, that midpoint can
 * drift away from the actual visual cut. Use the midpoint of the two
 * secondary-bus edges instead, while retaining the old value as a fallback
 * for panels that do not expose both sides of the transition.
 */
export function getSecondaryBusSectionBoundaryX(
  ranges: readonly SecondaryBusSectionRange[],
  leftSectionId: string,
  rightSectionId: string,
  fallbackX: number
): number {
  const leftEndX = Math.max(
    ...ranges
      .filter((range) => range.sectionId === leftSectionId)
      .map((range) => Math.max(range.startX, range.endX)),
    Number.NEGATIVE_INFINITY
  )
  const rightStartX = Math.min(
    ...ranges
      .filter((range) => range.sectionId === rightSectionId)
      .map((range) => Math.min(range.startX, range.endX)),
    Number.POSITIVE_INFINITY
  )

  if (!Number.isFinite(leftEndX) || !Number.isFinite(rightStartX)) return fallbackX
  if (leftEndX > rightStartX) return fallbackX
  return (leftEndX + rightStartX) / 2
}
