export type PlanKeyboardDecision =
  | { kind: 'ignore'; reason: string }
  | { kind: 'toggleSnap' }
  | { kind: 'toggleQuickPlacer' }
  | { kind: 'toggleWiring' }
  | { kind: 'toggleDrawMode' }
  | { kind: 'switchFloor'; floorId: string; index: number }
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

  const hasPrimaryModifier = event.ctrlKey || event.metaKey || event.altKey
  if (!hasPrimaryModifier && isPlanDeleteKey(event)) {
    return { kind: 'deleteSelection' }
  }

  if (hasPrimaryModifier) return { kind: 'ignore', reason: 'modifier key' }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
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
