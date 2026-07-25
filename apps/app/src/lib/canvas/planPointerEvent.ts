/** Touch activations have no button; mouse/pointer activations must use the primary button. */
export function isPrimaryPlanActivationEvent(event: object | null | undefined): boolean {
  if (!event || !('button' in event)) return true
  const button = (event as { button?: unknown }).button
  return typeof button !== 'number' || button === 0
}
