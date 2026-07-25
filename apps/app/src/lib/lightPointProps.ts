import type { LightPointDeviceProps } from '@/types/schema'

export function showLightPointSafetyOverlay(
  props: LightPointDeviceProps | undefined,
): boolean {
  return !!(props?.safety || props?.decentral)
}

export function showLightPointDecentralOverlay(
  props: LightPointDeviceProps | undefined,
): boolean {
  return !!(props?.decentral || props?.autonomous)
}

export function applyLightPointOptionToggle(
  prev: LightPointDeviceProps | undefined,
  key: 'safety' | 'decentral' | 'switch1p' | 'onWall',
): LightPointDeviceProps {
  const updated: LightPointDeviceProps = { ...(prev ?? {}) }
  const isActive = updated[key] ?? false

  if (key === 'onWall') {
    updated.onWall = !isActive
    return updated
  }

  if (key === 'switch1p') {
    updated.switch1p = !isActive
    if (updated.switch1p) {
      updated.safety = false
      updated.decentral = false
      updated.autonomous = false
    }
    return updated
  }

  if (key === 'safety') {
    const next = !isActive
    updated.safety = next
    updated.decentral = false
    updated.autonomous = false
    if (next) updated.switch1p = false
    return updated
  }

  const next = !isActive
  updated.decentral = next
  updated.autonomous = false
  if (next) {
    updated.safety = true
    updated.switch1p = false
  } else {
    updated.safety = false
  }
  return updated
}
