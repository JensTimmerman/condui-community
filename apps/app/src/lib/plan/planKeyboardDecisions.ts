export type PlanKeyboardDecision =
  | { kind: 'ignore'; reason: string }
  | { kind: 'toggleSnap' }
  | { kind: 'toggleQuickPlacer' }
  | { kind: 'toggleWiring' }
  | { kind: 'toggleDrawMode' }
  | { kind: 'switchFloor'; floorId: string; index: number }
  | { kind: 'copyFloorPlanSelection' }
  | { kind: 'pasteFloorPlanSelection' }
  | { kind: 'deleteSelection' }

export type PlanKeyboardEventInput = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  typing: boolean
}

export type PlanKeyboardDecisionContext = {
  pointerOverPlan: boolean
  suppressDigitFloorShortcuts: boolean
  floorIds: readonly string[]
  toolShortcuts?: {
    canToggleQuickPlacerAndWiring: boolean
    canToggleDrawMode: boolean
  }
  clipboardShortcuts?: boolean
}

type PlanPoint = { x: number; y: number }

/**
 * Pressing Enter on a point already in the active pen path finishes the path.
 * Revisiting an earlier vertex closes to that exact vertex; pressing Enter
 * again on the current tail simply finishes the open path like double-click.
 */
export function resolvePenEnterCommitPoints(
  currentPoints: readonly PlanPoint[],
  previewPoint: PlanPoint,
  epsilon = 1e-4
): PlanPoint[] | null {
  if (currentPoints.length < 2) return null
  const matchingIndex = currentPoints.findIndex(
    (point) =>
      Math.abs(point.x - previewPoint.x) <= epsilon && Math.abs(point.y - previewPoint.y) <= epsilon
  )
  if (matchingIndex < 0) return null
  if (matchingIndex === currentPoints.length - 1 || currentPoints.length < 3) {
    return [...currentPoints]
  }
  return [...currentPoints, currentPoints[matchingIndex]!]
}

export const PLAN_ARROW_KEY_PRECEDENCE =
  'Unmodified Arrow* keydown is reserved for plan symbol nudge. The plan keyboard dispatcher ignores Arrow* keys; the nudge listener is registered first by usePlanKeyboard and consumes eligible nudge events with preventDefault.'

const DIGIT_FLOOR_KEY = /^[1-9]$/
const ARROW_KEY = /^Arrow(Up|Down|Left|Right)$/

export function isPlanDeleteKey(event: Pick<PlanKeyboardEventInput, 'key' | 'code'>): boolean {
  return event.key === 'Delete' || event.code === 'Delete' || event.key === 'Backspace'
}

export function describePlanKeyboardDecision(
  event: PlanKeyboardEventInput,
  context: PlanKeyboardDecisionContext
): string {
  const decision = decidePlanKeyboardAction(event, context)
  switch (decision.kind) {
    case 'ignore':
      return `blocked: ${decision.reason}`
    case 'toggleSnap':
      return 'would toggle snap'
    case 'toggleQuickPlacer':
      return 'would toggle quick placer'
    case 'toggleWiring':
      return 'would toggle wiring'
    case 'toggleDrawMode':
      return 'would toggle draw mode'
    case 'switchFloor':
      return `would switch to floor index ${decision.index}`
    case 'deleteSelection':
      return 'would delete selection'
    case 'copyFloorPlanSelection':
      return 'would copy floor-plan selection'
    case 'pasteFloorPlanSelection':
      return 'would paste floor-plan selection'
  }
}

export function decidePlanKeyboardAction(
  event: PlanKeyboardEventInput,
  context: PlanKeyboardDecisionContext
): PlanKeyboardDecision {
  if (event.typing) return { kind: 'ignore', reason: 'typing target' }

  if (ARROW_KEY.test(event.code)) {
    return { kind: 'ignore', reason: 'arrow keys reserved for symbol nudge' }
  }

  const hasCommandModifier = event.ctrlKey || event.metaKey
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (context.clipboardShortcuts && hasCommandModifier && !event.altKey) {
    if (key === 'c') return { kind: 'copyFloorPlanSelection' }
    if (key === 'v') return { kind: 'pasteFloorPlanSelection' }
  }

  const hasPrimaryModifier = hasCommandModifier || event.altKey
  if (!hasPrimaryModifier && isPlanDeleteKey(event)) {
    return { kind: 'deleteSelection' }
  }

  if (hasPrimaryModifier) return { kind: 'ignore', reason: 'modifier key' }

  if (context.pointerOverPlan && key === 's') {
    return { kind: 'toggleSnap' }
  }

  if (context.pointerOverPlan && context.toolShortcuts) {
    if (key === 'q' && context.toolShortcuts.canToggleQuickPlacerAndWiring) {
      return { kind: 'toggleQuickPlacer' }
    }
    if (key === 'w' && context.toolShortcuts.canToggleQuickPlacerAndWiring) {
      return { kind: 'toggleWiring' }
    }
    if (key === 'd' && context.toolShortcuts.canToggleDrawMode) {
      return { kind: 'toggleDrawMode' }
    }
  }

  if (DIGIT_FLOOR_KEY.test(event.key)) {
    if (context.suppressDigitFloorShortcuts) {
      return { kind: 'ignore', reason: 'suppressDigitFloorShortcuts' }
    }
    const index = Number(event.key) - 1
    const floorId = context.floorIds[index]
    if (floorId) return { kind: 'switchFloor', floorId, index }
    return { kind: 'ignore', reason: `no floor at index ${index}` }
  }

  if (!context.pointerOverPlan && key === 's') {
    return { kind: 'ignore', reason: 'pointer not over plan container' }
  }

  return { kind: 'ignore', reason: 'unhandled key' }
}
