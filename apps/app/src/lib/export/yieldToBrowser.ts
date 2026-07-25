/**
 * Yield control to browser to prevent UI blocking
 * Used for chunked processing during export
 */

/**
 * Yield control to browser to prevent UI blocking
 * Uses requestIdleCallback if available, falls back to setTimeout
 */
export function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(), { timeout: 50 })
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Yield multiple times for longer operations
 * 
 * @param times Number of times to yield (default: 2)
 */
export async function yieldMultiple(times: number = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await yieldToBrowser()
  }
}
