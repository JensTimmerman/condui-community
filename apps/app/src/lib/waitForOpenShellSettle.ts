/**
 * Yields a few animation frames and one idle slice so layout and canvas work
 * can progress after raster preloads before we drop the blocking overlay.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

export async function waitForOpenShellSettle(): Promise<void> {
  await nextFrame()
  await nextFrame()
  await nextFrame()
  if (typeof requestIdleCallback === 'function') {
    await new Promise<void>((resolve) => {
      requestIdleCallback(() => resolve(), { timeout: 800 })
    })
  } else {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 16)
    })
  }
}
