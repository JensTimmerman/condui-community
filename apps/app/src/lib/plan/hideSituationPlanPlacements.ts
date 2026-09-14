/** Merge placement IDs into a floor's hidden situation-plan set. */
export function mergeHiddenSituationPlanPlacementIds(
  hiddenPlacementIds: readonly string[] | undefined,
  placementIds: readonly string[]
): string[] {
  return Array.from(new Set([...(hiddenPlacementIds ?? []), ...placementIds]))
}
