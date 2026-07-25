import { useMemo } from 'react'
import { isTouchPrimaryDevice } from '@/lib/canvas/touchHitZones'

/** True on iPad/tablet/phone — not desktop Mac/Windows with mouse as primary. */
export function useTouchPrimaryDevice(): boolean {
  return useMemo(() => isTouchPrimaryDevice(), [])
}
