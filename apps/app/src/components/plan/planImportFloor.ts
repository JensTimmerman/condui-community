import type { Floor } from '@/types/schema'
import { useUIStore } from '@/stores/uiStore'

/** Prefer the active plan floor, then a ground-level floor, then the first floor. */
export function resolveDefaultImportFloorId(
  floors: Floor[],
  activeFloorId: string | null | undefined,
): string | null {
  if (floors.length === 0) return null
  if (activeFloorId && floors.some((floor) => floor.id === activeFloorId)) {
    return activeFloorId
  }
  const groundFloor = floors.find((floor) => {
    const name = floor.name.toLowerCase()
    return name.includes('ground') || name.includes('grond')
  })
  return groundFloor?.id ?? floors[0]?.id ?? null
}

/** PDF destination remains a user choice before and after page discovery. */
export function shouldShowPdfDestinationOptions(
  fileName: string,
  _loadedPageCount: number,
): boolean {
  return fileName.toLowerCase().endsWith('.pdf')
}

/** Fit plan canvas after import; image load may complete after the dialog closes. */
export function schedulePlanFitToViewAfterImport(): void {
  const { requestFitToView } = useUIStore.getState()
  requestFitToView(['plan'])
  requestAnimationFrame(() => {
    requestFitToView(['plan'])
  })
  window.setTimeout(() => requestFitToView(['plan']), 200)
}
