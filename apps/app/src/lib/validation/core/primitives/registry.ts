import type { CheckContext, CheckResult, Issue } from './common'

type PrimitiveRegistry = Map<
  string,
  (context: CheckContext, params?: Record<string, unknown>) => CheckResult | Issue[]
>

const primitives: PrimitiveRegistry = new Map()

/**
 * Register a primitive check function.
 */
export function registerPrimitive(
  name: string,
  fn: (context: CheckContext, params?: Record<string, unknown>) => CheckResult | Issue[]
): void {
  primitives.set(name, fn)
}

/**
 * Get a primitive check function by name.
 */
export function getPrimitive(
  name: string
):
  | ((context: CheckContext, params?: Record<string, unknown>) => CheckResult | Issue[])
  | undefined {
  return primitives.get(name)
}
