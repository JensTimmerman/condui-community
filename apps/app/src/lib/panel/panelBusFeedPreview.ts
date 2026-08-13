import type { PanelBusFeedKind } from './panelFeedOrganization'

export const PANEL_BUS_FEED_GAP = 24

export interface PanelBusFeedPreviewItem {
  x: number
  kind: PanelBusFeedKind
}

export interface PanelBusFeedPreviewRun {
  kind: PanelBusFeedKind
  startX: number
  endX: number
}

export interface PanelBusFeedPreview {
  currentRuns: PanelBusFeedPreviewRun[]
  resultRuns: PanelBusFeedPreviewRun[]
  resultCutXs: number[]
  affectedStartX: number
  action: 'split' | 'merge' | 'move' | 'unchanged'
  introducedKind?: PanelBusFeedKind
}

function buildRuns(
  items: readonly PanelBusFeedPreviewItem[],
  busStartX: number,
  busEndX: number,
): PanelBusFeedPreviewRun[] {
  if (items.length === 0) return []
  const runs: PanelBusFeedPreviewRun[] = []
  let runStartX = busStartX
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const next = items[index + 1]
    if (next && next.kind === item.kind) continue
    const runEndX = next ? (item.x + next.x) / 2 : busEndX
    runs.push({ kind: item.kind, startX: runStartX, endX: runEndX })
    runStartX = runEndX
  }
  return runs
}

export function getLeftBiasedBusFeedStubX(startX: number, endX: number): number {
  const width = Math.max(0, endX - startX)
  return startX + Math.min(20, Math.max(8, width * 0.3))
}

export function calculatePanelBusFeedPreview(
  items: readonly PanelBusFeedPreviewItem[],
  insertIndex: number,
  droppedKind: PanelBusFeedKind,
  busStartX: number,
  busEndX: number,
  initializeSplit = false,
): PanelBusFeedPreview {
  const ordered = [...items].sort((left, right) => left.x - right.x)
  const currentRuns = buildRuns(ordered, busStartX, busEndX)
  const baseKind: PanelBusFeedKind = initializeSplit
    ? droppedKind === 'backup'
      ? 'grid'
      : 'backup'
    : droppedKind
  const normalizedIndex = Math.max(0, Math.min(ordered.length, insertIndex))
  const resultItems = ordered.map((item, index) => ({
    ...item,
    kind: index >= normalizedIndex ? droppedKind : initializeSplit ? baseKind : item.kind,
  }))
  const resultRuns = buildRuns(resultItems, busStartX, busEndX)
  const currentCuts = currentRuns.slice(0, -1).map((run) => run.endX)
  const resultCutXs = resultRuns.slice(0, -1).map((run) => run.endX)
  const sameCuts =
    currentCuts.length === resultCutXs.length &&
    currentCuts.every((cut, index) => Math.abs(cut - resultCutXs[index]!) < 0.01)
  const action = sameCuts
    ? 'unchanged'
    : resultCutXs.length > currentCuts.length
      ? 'split'
      : resultCutXs.length < currentCuts.length
        ? 'merge'
        : 'move'
  const affectedStartX =
    normalizedIndex <= 0
      ? busStartX
      : normalizedIndex >= ordered.length
        ? busEndX
        : (ordered[normalizedIndex - 1]!.x + ordered[normalizedIndex]!.x) / 2
  const currentKinds = new Set(ordered.map((item) => item.kind))

  return {
    currentRuns,
    resultRuns,
    resultCutXs,
    affectedStartX,
    action,
    introducedKind: currentKinds.has(droppedKind) ? undefined : droppedKind,
  }
}
